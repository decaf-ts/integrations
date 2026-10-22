/**
 * @module integrations/tests/integration/comms/smtp.mailpit
 * @summary SAA-1109 (DECAF-809 Phase A slice 4): live SMTP delivery through
 * Mailpit for `EmailService`, including explicit `boot(config)` usage.
 * @description Boots against the Mailpit compose service
 * (`docker/mailpit-compose.yml`, also part of `npm run prepare-it-tests`),
 * sends real messages, and verifies recipient, subject, body, `Message-ID`
 * and the authenticated username through Mailpit's HTTP API. Endpoint
 * resolution honors `DECAF_SMTP_HOST`/`DECAF_SMTP_PORT`/`DECAF_MAILPIT_HTTP`
 * with the documented loopback defaults, falling back to the Docker bridge
 * gateway when the runner is a sibling container (same pattern as
 * `tests/helpers/redis.ts`).
 */
import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { readFileSync } from "node:fs";
import net from "node:net";
import { InternalError } from "@decaf-ts/db-decorators";
import { EmailService } from "../../../src/comms/email/EmailService";

jest.setTimeout(60000);

interface MailpitAddress {
  Name: string;
  Address: string;
}

interface MailpitMessageSummary {
  ID: string;
  MessageID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Cc: MailpitAddress[] | null;
  Bcc: MailpitAddress[] | null;
  Subject: string;
  Username: string;
  Snippet: string;
}

interface MailpitMessageDetail extends MailpitMessageSummary {
  Text: string;
  HTML: string;
  ReturnPath: string;
}

interface MailpitMessageList {
  total: number;
  messages: MailpitMessageSummary[];
}

interface MailpitEndpoint {
  host: string;
  port: number;
  httpBase: string;
}

const RUN_TOKEN = `saa-1109-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

let endpoint: MailpitEndpoint;

function gatewayHosts(): string[] {
  const hosts: string[] = [];
  try {
    const route = readFileSync("/proc/net/route", "utf8");
    for (const line of route.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3 || parts[1] !== "00000000") continue;
      const octets = parts[2].match(/../g)?.reverse();
      if (octets && octets.length === 4) {
        hosts.push(octets.map((octet) => parseInt(octet, 16)).join("."));
      }
    }
  } catch {
    // not Linux or no route table; the explicit/default candidates still apply
  }
  return hosts;
}

function canConnect(host: string, port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function canFetch(url: string, timeoutMs = 1000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveMailpitEndpoint(): Promise<MailpitEndpoint> {
  const explicitHost = process.env.DECAF_SMTP_HOST;
  const explicitHttp = process.env.DECAF_MAILPIT_HTTP;
  const port = Number(process.env.DECAF_SMTP_PORT ?? 1025);
  if (explicitHost || explicitHttp) {
    const host = explicitHost ?? "127.0.0.1";
    return {
      host,
      port,
      httpBase: explicitHttp ?? `http://${host}:8025`,
    };
  }
  const candidates = ["127.0.0.1", ...gatewayHosts()].filter(
    (host, index, all) => all.indexOf(host) === index
  );
  for (const host of candidates) {
    const httpBase = `http://${host}:8025`;
    if (
      (await canConnect(host, port)) &&
      (await canFetch(`${httpBase}/api/v1/messages`))
    ) {
      return { host, port, httpBase };
    }
  }
  throw new Error(
    `Mailpit is not reachable. Tried ${candidates.join(", ")}:${port} and ` +
      `http://<host>:8025. Start it with "npm run prepare-it-tests" or ` +
      `"docker compose -f docker/mailpit-compose.yml up -d --wait", or set ` +
      `DECAF_SMTP_HOST/DECAF_SMTP_PORT/DECAF_MAILPIT_HTTP.`
  );
}

async function mailpitJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${endpoint.httpBase}${path}`, init);
  if (!response.ok) {
    throw new Error(
      `Mailpit ${init?.method ?? "GET"} ${path} failed with ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

async function mailpitText(path: string): Promise<string> {
  const response = await fetch(`${endpoint.httpBase}${path}`);
  if (!response.ok) {
    throw new Error(
      `Mailpit GET ${path} failed with ${response.status}: ${await response.text()}`
    );
  }
  return response.text();
}

async function clearMailpit(): Promise<void> {
  const response = await fetch(`${endpoint.httpBase}/api/v1/messages`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      `Mailpit DELETE /api/v1/messages failed with ${response.status}`
    );
  }
}

async function waitForMessage(subject: string): Promise<MailpitMessageSummary> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const list = await mailpitJson<MailpitMessageList>(
      "/api/v1/messages?limit=200"
    );
    const match = list.messages.find((message) => message.Subject === subject);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mailpit did not receive the message with subject "${subject}"`);
}

function withoutBrackets(messageId: string): string {
  return messageId.replace(/^</, "").replace(/>$/, "");
}

beforeAll(async () => {
  endpoint = await resolveMailpitEndpoint();
  await clearMailpit();
});

afterAll(async () => {
  if (!endpoint) return;
  await clearMailpit();
});

describe("EmailService live SMTP delivery through Mailpit", () => {
  it("delivers a message and exposes recipient, subject, body, and Message-ID", async () => {
    const subject = `${RUN_TOKEN} EmailService delivery`;
    const service = new EmailService();
    await service.initialize({
      provider: "smtp",
      host: endpoint.host,
      port: endpoint.port,
      secure: false,
      from: "sender@example.test",
    });

    try {
      const result = await service.send({
        to: "recipient@example.test",
        subject,
        text: "hello from EmailService",
      });

      expect(result.provider).toBe("smtp");
      expect(result.from).toBe("sender@example.test");
      expect(result.recipients).toEqual(["recipient@example.test"]);
      expect(result.messageId).toMatch(/^<.+@as-graph>$/);

      const summary = await waitForMessage(subject);
      expect(summary.From.Address).toBe("sender@example.test");
      expect(summary.To.map((address) => address.Address)).toEqual([
        "recipient@example.test",
      ]);
      expect(summary.MessageID).toBe(withoutBrackets(result.messageId));

      const detail = await mailpitJson<MailpitMessageDetail>(
        `/api/v1/message/${summary.ID}`
      );
      expect(detail.Subject).toBe(subject);
      expect(detail.Text).toContain("hello from EmailService");

      const raw = await mailpitText(`/api/v1/message/${summary.ID}/raw`);
      expect(raw).toContain(`Message-ID: ${result.messageId}`);
      expect(raw).toContain("Subject: " + subject);
    } finally {
      await service.shutdown().catch(() => undefined);
    }
  });

  it("delivers through EmailService.boot() with an explicit configuration", async () => {
    const subject = `${RUN_TOKEN} explicit EmailService delivery`;
    const service = new EmailService();
    await service.boot({
      provider: "smtp",
      host: endpoint.host,
      port: endpoint.port,
      secure: false,
      from: "node-sender@example.test",
    });

    try {
      const result = await service.send({
        to: "node-recipient@example.test",
        subject,
        text: "hello from explicit EmailService",
      });

      expect(result.provider).toBe("smtp");
      expect(result.from).toBe("node-sender@example.test");

      const summary = await waitForMessage(subject);
      expect(summary.From.Address).toBe("node-sender@example.test");
      expect(summary.To.map((address) => address.Address)).toEqual([
        "node-recipient@example.test",
      ]);
      expect(summary.MessageID).toBe(withoutBrackets(result.messageId));

      const detail = await mailpitJson<MailpitMessageDetail>(
        `/api/v1/message/${summary.ID}`
      );
      expect(detail.Text).toContain("hello from explicit EmailService");
    } finally {
      await service.shutdown().catch(() => undefined);
    }
  });

  it("delivers with AUTH LOGIN when allowPlaintextAuth opts in", async () => {
    const subject = `${RUN_TOKEN} authenticated delivery`;
    const service = new EmailService();
    await service.initialize({
      provider: "smtp",
      host: endpoint.host,
      port: endpoint.port,
      secure: false,
      username: "auth-user@example.test",
      password: "secret",
      allowPlaintextAuth: true,
      from: "auth-user@example.test",
    });

    try {
      const result = await service.send({
        to: "auth-recipient@example.test",
        subject,
        text: "hello authenticated",
      });

      expect(result.from).toBe("auth-user@example.test");
      const summary = await waitForMessage(subject);
      expect(summary.Username).toBe("auth-user@example.test");
      expect(summary.MessageID).toBe(withoutBrackets(result.messageId));
    } finally {
      await service.shutdown().catch(() => undefined);
    }
  });

  it("fails closed before AUTH when plaintext authentication is not allowed", async () => {
    const subject = `${RUN_TOKEN} fail closed`;
    const service = new EmailService();
    await service.initialize({
      provider: "smtp",
      host: endpoint.host,
      port: endpoint.port,
      secure: false,
      username: "auth-user@example.test",
      password: "secret",
      from: "auth-user@example.test",
    });

    try {
      await expect(
        service.send({
          to: "auth-recipient@example.test",
          subject,
          text: "must not be delivered",
        })
      ).rejects.toBeInstanceOf(InternalError);
    } finally {
      await service.shutdown().catch(() => undefined);
    }

    const list = await mailpitJson<MailpitMessageList>(
      "/api/v1/messages?limit=200"
    );
    expect(list.messages.some((message) => message.Subject === subject)).toBe(
      false
    );
  });
});
