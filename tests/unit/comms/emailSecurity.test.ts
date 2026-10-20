/**
 * @module integrations/tests/unit/comms/emailSecurity
 * @summary SAA-1062 (SAA-1044 verification): regression coverage for the Stage 3
 * email hardening — header/envelope injection (F1), Graph OData/path injection
 * (F2), and the plaintext-AUTH posture (F5).
 * @description Drives the real MIME builder, `SmtpClient`, and `EmailService`
 * against process-local loopback SMTP/HTTP stubs so every assertion observes
 * the exact bytes the production code would put on the wire.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createServer, type IncomingMessage } from "node:http";
import { BadRequestError, InternalError } from "@decaf-ts/db-decorators";
import {
  buildEmail,
  parseAddressList,
  type EmailMessageInput,
} from "../../../src/comms/email/mime";
import { SmtpClient } from "../../../src/comms/email/smtp";
import { EmailService } from "../../../src/comms/email/EmailService";
import type { AddressInfo } from "node:net";

interface CapturedMail {
  from: string;
  recipients: string[];
  raw: string;
}

interface SmtpStub {
  host: string;
  port: number;
  commands: string[];
  messages: CapturedMail[];
  close(): Promise<void>;
}

/**
 * Minimal recording SMTP server. It deliberately does not advertise STARTTLS,
 * so every session is plaintext, and it answers `AUTH LOGIN` when the client
 * opts in to plaintext authentication.
 */
async function startSmtpStub(): Promise<SmtpStub> {
  const commands: string[] = [];
  const messages: CapturedMail[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const net = await import("node:net");
  let from = "";
  let recipients: string[] = [];
  let inData = false;
  let data: string[] = [];
  let authStep = 0;

  const tcp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
    socket.write("220 saa1062-smtp stub\r\n");

    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\r\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(line);
        index = buffer.indexOf("\r\n");
      }
    });

    const handle = (line: string) => {
      commands.push(line);
      if (inData) {
        if (line === ".") {
          inData = false;
          messages.push({ from, recipients: [...recipients], raw: data.join("\r\n") });
          from = "";
          recipients = [];
          data = [];
          socket.write("250 2.0.0 Queued\r\n");
        } else {
          data.push(line.startsWith("..") ? line.slice(1) : line);
        }
        return;
      }
      if (authStep > 0) {
        authStep += 1;
        if (authStep === 3) {
          authStep = 0;
          socket.write("235 2.7.0 Authentication successful\r\n");
        } else {
          socket.write("334 UGFzc3dvcmQ6\r\n");
        }
        return;
      }
      const command = line.split(" ")[0]?.toUpperCase();
      switch (command) {
        case "EHLO":
          socket.write(
            "250-saa1062-smtp\r\n250-8BITMIME\r\n250-AUTH LOGIN\r\n250 OK\r\n"
          );
          break;
        case "STARTTLS":
          // This stub never offers TLS: refuse the upgrade explicitly so the
          // client's requireTLS path fails closed instead of waiting for a
          // handshake on a plaintext socket.
          socket.write("454 4.7.0 TLS not available\r\n");
          break;
        case "AUTH":
          if (/^AUTH\s+LOGIN/i.test(line)) {
            authStep = 1;
            socket.write("334 VXNlcm5hbWU6\r\n");
          } else {
            socket.write("504 Unsupported authentication\r\n");
          }
          break;
        case "MAIL": {
          from = /<([^>]*)>/.exec(line)?.[1] ?? "";
          socket.write("250 2.1.0 OK\r\n");
          break;
        }
        case "RCPT": {
          const match = /<([^>]*)>/.exec(line)?.[1];
          if (match) recipients.push(match);
          socket.write("250 2.1.5 OK\r\n");
          break;
        }
        case "DATA":
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          break;
        case "QUIT":
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
          break;
        default:
          socket.write("250 OK\r\n");
          break;
      }
    };
  });

  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", () => resolve()));
  const address = tcp.address() as AddressInfo;
  return {
    host: "127.0.0.1",
    port: address.port,
    commands,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        tcp.close(() => resolve());
      }),
  };
}

interface HttpStub {
  baseUrl: string;
  requests: string[];
  close(): Promise<void>;
}

async function startHttpStub(): Promise<HttpStub> {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    requests.push(request.url ?? "/");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ value: [{ id: "msg-1" }] }));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

const VALID_INPUT: EmailMessageInput = {
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "SAA-1062 valid message",
  text: "body",
};

describe("Email hardening (SAA-1044 F1/F2/F5)", () => {
  let smtp: SmtpStub;
  let http: HttpStub;

  beforeAll(async () => {
    smtp = await startSmtpStub();
    http = await startHttpStub();
  });

  afterAll(async () => {
    await smtp.close();
    await http.close();
  });

  describe("F1 address and MIME header/envelope injection", () => {
    const forbidden = [
      ["CRLF header injection", "a@b.com\r\nBcc: attacker@evil.test"],
      ["bare LF", "a@b.com\nBcc: attacker@evil.test"],
      ["bare CR", "a@b.com\rBcc: attacker@evil.test"],
      ["NUL", "a@b.com\u0000"],
      ["C0 control", "a@b.com\u0001"],
      ["DEL", "a@b.com\u007f"],
      ["C1 control", "a@b.com\u0085"],
    ] as const;

    it.each(forbidden)("parseAddressList rejects %s", (_name, value) => {
      expect(() => parseAddressList(value)).toThrow(BadRequestError);
    });

    it.each(forbidden)("buildEmail rejects %s in to/cc/bcc", (_name, value) => {
      expect(() =>
        buildEmail({ ...VALID_INPUT, to: value })
      ).toThrow(BadRequestError);
      expect(() =>
        buildEmail({ ...VALID_INPUT, cc: value })
      ).toThrow(BadRequestError);
      expect(() =>
        buildEmail({ ...VALID_INPUT, bcc: value })
      ).toThrow(BadRequestError);
    });

    it.each(forbidden)("buildEmail rejects %s in from", (_name, value) => {
      expect(() =>
        buildEmail({ ...VALID_INPUT, from: value })
      ).toThrow(BadRequestError);
    });

    it.each(forbidden)("buildEmail rejects %s in replyTo", (_name, value) => {
      expect(() =>
        buildEmail({ ...VALID_INPUT, replyTo: value })
      ).toThrow(BadRequestError);
    });

    it("rejects display-name and header-smuggling values in any address field", () => {
      for (const value of [
        "Sender Name <sender@example.com>",
        "a@b.com\nBcc: x@y",
        "recipient@example.com, attacker@evil.test>",
        "not-an-address",
      ]) {
        expect(() => buildEmail({ ...VALID_INPUT, to: value })).toThrow(
          BadRequestError
        );
      }
      expect(() =>
        buildEmail({ ...VALID_INPUT, from: "Sender <sender@example.com>" })
      ).toThrow(BadRequestError);
    });

    it("accepts basic dot-atom mailboxes, trims, and drops empties", () => {
      expect(parseAddressList(" a@b.com , ,c.d+e@sub.example.org ")).toEqual([
        "a@b.com",
        "c.d+e@sub.example.org",
      ]);
      expect(buildEmail(VALID_INPUT).recipients).toEqual([
        "recipient@example.com",
      ]);
    });

    const safeBase: EmailMessageInput = {
      ...VALID_INPUT,
      attachments: [
        { filename: "report.txt", content: "aGVsbG8=", contentType: "text/plain" },
      ],
    };

    it.each([
      "evil\r\nX-Injected: 1.txt",
      "evil\n.txt",
      "evil\r.txt",
      "evil\u0000.txt",
      "evil\u0001.txt",
      'evil".txt',
      "evil\\name.txt",
    ])("rejects unsafe attachment filename %p", (filename) => {
      expect(() =>
        buildEmail({
          ...safeBase,
          attachments: [{ filename, content: "aGVsbG8=" }],
        })
      ).toThrow(BadRequestError);
    });

    it.each([
      "text/plain\r\nX-Injected: 1",
      "text/plain\nX-Injected: 1",
      "text/plain\u0000",
      "text/plain\u0001",
      "not-a-type",
      "text/",
      "/plain",
      'text/plain; name="a\\b"',
    ])("rejects malformed or unsafe content type %p", (contentType) => {
      expect(() =>
        buildEmail({
          ...safeBase,
          attachments: [{ filename: "report.txt", content: "aGVsbG8=", contentType }],
        })
      ).toThrow(BadRequestError);
    });

    it("accepts a valid content type and the default octet-stream", () => {
      const withPlain = buildEmail(safeBase);
      expect(withPlain.raw).toContain("Content-Type: text/plain");
      const withDefault = buildEmail({
        ...VALID_INPUT,
        attachments: [{ filename: "report.bin", content: "aGVsbG8=" }],
      });
      expect(withDefault.raw).toContain(
        "Content-Type: application/octet-stream"
      );
    });

    it("SmtpClient.send rejects CRLF in the envelope sender and recipients before writing a command", async () => {
      const client = new SmtpClient({ host: smtp.host, port: smtp.port });
      await client.connect();
      const before = smtp.commands.length;
      try {
        await expect(
          client.send("sender@example.com\r\nRCPT TO:<evil@example.com>", [
            "recipient@example.com",
          ], "")
        ).rejects.toBeInstanceOf(BadRequestError);
        await expect(
          client.send("sender@example.com", [
            "recipient@example.com\nRCPT TO:<evil@example.com>",
          ], "")
        ).rejects.toBeInstanceOf(BadRequestError);
        const written = smtp.commands.slice(before);
        expect(written.some((line) => /^MAIL FROM/i.test(line))).toBe(false);
        expect(written.join("\n")).not.toContain("evil@example.com");
      } finally {
        await client.close();
      }
    });

    it("SmtpClient.send delivers a valid message with intact headers", async () => {
      const client = new SmtpClient({ host: smtp.host, port: smtp.port });
      await client.connect();
      const built = buildEmail({ ...VALID_INPUT, subject: "SAA-1062 intact" });
      try {
        await client.send(built.from, built.recipients, built.raw);
      } finally {
        await client.close();
      }
      expect(smtp.messages).toHaveLength(1);
      const [mail] = smtp.messages;
      expect(mail.from).toBe("sender@example.com");
      expect(mail.recipients).toEqual(["recipient@example.com"]);
      expect(mail.raw).toContain("From: sender@example.com");
      expect(mail.raw).toContain("To: recipient@example.com");
      expect(mail.raw).toContain("Subject: SAA-1062 intact");
      expect(mail.raw).toContain("Message-ID: <");
    });
  });

  describe("F2 Graph mailbox path and OData filter injection", () => {
    async function graphService(): Promise<EmailService> {
      const service = new EmailService();
      await service.initialize({
        token: "saa1062-graph-token",
        graphBaseUrl: http.baseUrl,
      });
      return service;
    }

    it("URL-encodes the mailbox as a single path segment", async () => {
      const service = await graphService();
      const before = http.requests.length;
      try {
        await service.listInbox({ mailbox: "a/b" });
      } finally {
        await service.shutdown().catch(() => undefined);
      }
      const incoming = http.requests.slice(before);
      expect(incoming).toHaveLength(1);
      expect(new URL(incoming[0], http.baseUrl).pathname).toBe(
        "/a%2Fb/messages"
      );
      expect(incoming[0]).not.toContain("/a/b/");
    });

    it("doubles single quotes in the subject filter so it cannot break out", async () => {
      const service = await graphService();
      const before = http.requests.length;
      try {
        await service.listInbox({ subject: "x' or subject eq 'y" });
      } finally {
        await service.shutdown().catch(() => undefined);
      }
      const url = new URL(http.requests[before], http.baseUrl);
      expect(url.searchParams.get("$filter")).toBe(
        "contains(subject,'x'' or subject eq ''y')"
      );
    });

    it("rejects a non-ISO since value with BadRequestError before any request", async () => {
      const service = await graphService();
      const before = http.requests.length;
      try {
        await expect(
          service.listInbox({ since: "yesterday" })
        ).rejects.toBeInstanceOf(BadRequestError);
        await expect(
          service.listInbox({ since: "2026-01-02' or subject eq 'x" })
        ).rejects.toBeInstanceOf(BadRequestError);
      } finally {
        await service.shutdown().catch(() => undefined);
      }
      expect(http.requests).toHaveLength(before);
    });

    it("emits a valid ISO date unquoted in the filter", async () => {
      const service = await graphService();
      const before = http.requests.length;
      try {
        await service.listInbox({ since: "2026-01-02T03:04:05Z" });
      } finally {
        await service.shutdown().catch(() => undefined);
      }
      const url = new URL(http.requests[before], http.baseUrl);
      expect(url.searchParams.get("$filter")).toBe(
        "receivedDateTime ge 2026-01-02T03:04:05Z"
      );
      expect(url.searchParams.get("$filter")).not.toContain(
        "'2026-01-02T03:04:05Z'"
      );
    });
  });

  describe("F5 SMTP plaintext-AUTH posture", () => {
    it("refuses AUTH over a plaintext session and never sends it", async () => {
      const before = smtp.commands.length;
      const client = new SmtpClient({
        host: smtp.host,
        port: smtp.port,
        username: "user@example.com",
        password: "secret",
      });
      await expect(client.connect()).rejects.toBeInstanceOf(InternalError);
      await client.close().catch(() => undefined);
      const written = smtp.commands.slice(before);
      expect(written.some((line) => /^AUTH\b/i.test(line))).toBe(false);
      expect(written.join("\n")).not.toContain("user@example.com");
    });

    it("proceeds with AUTH LOGIN when allowPlaintextAuth is explicitly set", async () => {
      const before = smtp.commands.length;
      const client = new SmtpClient({
        host: smtp.host,
        port: smtp.port,
        username: "user@example.com",
        password: "secret",
        allowPlaintextAuth: true,
      });
      await client.connect();
      await client.close();
      const written = smtp.commands.slice(before);
      expect(written).toContain("AUTH LOGIN");
    });

    it("EmailService.send fails closed before AUTH without the opt-in", async () => {
      const service = new EmailService();
      await service.initialize({
        provider: "smtp",
        host: smtp.host,
        port: smtp.port,
        secure: false,
        username: "user@example.com",
        password: "secret",
        from: "sender@example.com",
      });
      const before = smtp.commands.length;
      try {
        await expect(
          service.send({
            from: "sender@example.com",
            to: "recipient@example.com",
            subject: "SAA-1062 plaintext refused",
            text: "body",
          })
        ).rejects.toBeInstanceOf(InternalError);
        expect(
          smtp.commands.slice(before).some((line) => /^AUTH\b/i.test(line))
        ).toBe(false);
      } finally {
        await service.shutdown().catch(() => undefined);
      }
    });

    it("EmailService.send delivers when allowPlaintextAuth is set", async () => {
      const service = new EmailService();
      await service.initialize({
        provider: "smtp",
        host: smtp.host,
        port: smtp.port,
        secure: false,
        username: "user@example.com",
        password: "secret",
        allowPlaintextAuth: true,
        from: "sender@example.com",
      });
      const before = smtp.messages.length;
      try {
        await service.send({
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "SAA-1062 plaintext allowed",
          text: "body",
        });
      } finally {
        await service.shutdown().catch(() => undefined);
      }
      expect(smtp.messages).toHaveLength(before + 1);
      expect(smtp.messages[before].raw).toContain(
        "Subject: SAA-1062 plaintext allowed"
      );
    });
  });
});
