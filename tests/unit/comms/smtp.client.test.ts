/**
 * @module integrations/tests/unit/comms/smtp.client
 * @summary SAA-1109 (DECAF-809 Phase A slice 4): unit coverage for the
 * nodemailer-backed `SmtpClient` transport mapping, optional-peer failure,
 * envelope validation, error mapping, and STARTTLS/implicit-TLS behavior.
 * @description The transport-option cases replace the optional `nodemailer`
 * peer with `jest.unstable_mockModule` and capture the options handed to
 * `createTransport`; the TLS cases unmock the peer and drive a process-local
 * plaintext SMTP stub that upgrades with a generated self-signed certificate,
 * plus a `tls.createServer` stub for `secure: true`.
 */
import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer, type Socket } from "node:net";
import {
  createServer as createTlsServer,
  TLSSocket,
  createSecureContext,
  type SecureContext,
} from "node:tls";
import { BadRequestError, InternalError } from "@decaf-ts/db-decorators";

type SmtpModule = typeof import("../../../src/comms/email/smtp");
type SmtpClientConstructor = SmtpModule["SmtpClient"];

interface TransportExpectation {
  host: string;
  port: number;
  secure: boolean;
  name: string;
  requireTLS: boolean;
  auth?: { user: string; pass: string; method: string };
  tls?: { rejectUnauthorized: boolean };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

interface FakeTransportCalls {
  options: Record<string, any>[];
  defaults: Record<string, any>[];
  verify: number;
  close: number;
  sendMail: Record<string, any>[];
}

interface FakeMailer {
  calls: FakeTransportCalls;
  record(
    transportOptions: Record<string, any>,
    defaults?: Record<string, any>
  ): Record<string, unknown>;
}

function createFakeMailer(options?: {
  verifyError?: Error;
  sendError?: Error;
}): FakeMailer {
  const calls: FakeTransportCalls = {
    options: [],
    defaults: [],
    verify: 0,
    close: 0,
    sendMail: [],
  };
  const transporter = {
    verify: jest.fn(async () => {
      calls.verify += 1;
      if (options?.verifyError) throw options.verifyError;
    }),
    sendMail: jest.fn(async (message: Record<string, any>) => {
      calls.sendMail.push(message);
      if (options?.sendError) throw options.sendError;
      return { messageId: "fake-message-id" };
    }),
    close: jest.fn(() => {
      calls.close += 1;
    }),
  };
  return {
    calls,
    record(transportOptions, defaults) {
      calls.options.push(transportOptions);
      calls.defaults.push(defaults ?? {});
      return transporter;
    },
  };
}

let currentMailer: FakeMailer = createFakeMailer();

const createTransport = jest.fn(
  (transportOptions: Record<string, any>, defaults?: Record<string, any>) =>
    currentMailer.record(transportOptions, defaults)
);

jest.unstable_mockModule("nodemailer", () => ({ createTransport }));

function useMailer(options?: { verifyError?: Error; sendError?: Error }): FakeMailer {
  currentMailer = createFakeMailer(options);
  createTransport.mockClear();
  return currentMailer;
}

function optionsFrom(calls: FakeTransportCalls): TransportExpectation {
  expect(calls.options).toHaveLength(1);
  return calls.options[0] as TransportExpectation;
}

describe("SmtpClient transport options (nodemailer)", () => {
  let SmtpClient: SmtpClientConstructor;

  beforeAll(async () => {
    ({ SmtpClient } = (await import(
      "../../../src/comms/email/smtp"
    )) as SmtpModule);
  });

  it("defaults to opportunistic plaintext on port 587 with no auth", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });

    await client.connect();

    const options = optionsFrom(fake.calls);
    expect(options).toEqual({
      host: "mail.example.test",
      port: 587,
      secure: false,
      name: "as-graph",
      requireTLS: false,
      auth: undefined,
      tls: undefined,
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
    });
    expect(fake.calls.defaults[0]).toEqual({
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await client.close();
  });

  it("selects implicit TLS and port 465 when secure is true", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test", secure: true });

    await client.connect();

    const options = optionsFrom(fake.calls);
    expect(options.secure).toBe(true);
    expect(options.port).toBe(465);
    expect(options.requireTLS).toBe(false);
    await client.close();
  });

  it("keeps an explicitly configured port", async () => {
    const fake = useMailer();
    const client = new SmtpClient({
      host: "mail.example.test",
      port: 2525,
      secure: true,
    });

    await client.connect();

    expect(optionsFrom(fake.calls).port).toBe(2525);
    await client.close();
  });

  it("maps credentials to AUTH LOGIN and requires TLS by default", async () => {
    const fake = useMailer();
    const client = new SmtpClient({
      host: "mail.example.test",
      username: "sender@example.test",
      password: "secret",
    });

    await client.connect();

    const options = optionsFrom(fake.calls);
    expect(options.auth).toEqual({
      user: "sender@example.test",
      pass: "secret",
      method: "LOGIN",
    });
    expect(options.requireTLS).toBe(true);
    await client.close();
  });

  it("disables requireTLS when allowPlaintextAuth opts in", async () => {
    const fake = useMailer();
    const client = new SmtpClient({
      host: "mail.example.test",
      username: "sender@example.test",
      password: "secret",
      allowPlaintextAuth: true,
    });

    await client.connect();

    const options = optionsFrom(fake.calls);
    expect(options.auth?.method).toBe("LOGIN");
    expect(options.requireTLS).toBe(false);
    await client.close();
  });

  it("does not require STARTTLS for implicit TLS with credentials", async () => {
    const fake = useMailer();
    const client = new SmtpClient({
      host: "mail.example.test",
      secure: true,
      username: "sender@example.test",
      password: "secret",
    });

    await client.connect();

    const options = optionsFrom(fake.calls);
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
    await client.close();
  });

  it("maps timeout to connection, greeting, and socket timeouts", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test", timeout: 4321 });

    await client.connect();

    const options = optionsFrom(fake.calls);
    expect(options.connectionTimeout).toBe(4321);
    expect(options.greetingTimeout).toBe(4321);
    expect(options.socketTimeout).toBe(4321);
    await client.close();
  });

  it("maps allowUnauthorizedCerts to tls.rejectUnauthorized=false", async () => {
    const fake = useMailer();
    const client = new SmtpClient({
      host: "mail.example.test",
      allowUnauthorizedCerts: true,
    });

    await client.connect();

    expect(optionsFrom(fake.calls).tls).toEqual({
      rejectUnauthorized: false,
    });
    await client.close();
  });

  it("maps clientHostname to the EHLO name", async () => {
    const fake = useMailer();
    const client = new SmtpClient({
      host: "mail.example.test",
      clientHostname: "mailer.example.test",
    });

    await client.connect();

    expect(optionsFrom(fake.calls).name).toBe("mailer.example.test");
    await client.close();
  });

  it("connects once even when connect() is called repeatedly", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });

    await client.connect();
    await client.connect();

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(fake.calls.verify).toBe(1);
    await client.close();
  });

  it("maps a transport verify() failure to InternalError and closes the transport", async () => {
    const fake = useMailer({
      verifyError: Object.assign(new Error("connection refused"), {
        code: "ECONNECTION",
      }),
    });
    const client = new SmtpClient({ host: "mail.example.test" });

    await expect(client.connect()).rejects.toThrow(
      "SMTP connection failed: connection refused"
    );
    await expect(client.connect()).rejects.toBeInstanceOf(InternalError);
    expect(fake.calls.verify).toBe(2);
    expect(fake.calls.close).toBe(2);
  });

  it("rejects send() before connect() with InternalError", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });

    await expect(
      client.send("sender@example.test", ["recipient@example.test"], "raw")
    ).rejects.toThrow("SMTP client is not connected");
    expect(fake.calls.sendMail).toHaveLength(0);
  });

  it("validates the envelope sender before calling sendMail", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });
    await client.connect();

    try {
      await expect(
        client.send(
          "sender@example.test\r\nRCPT TO:<evil@example.test>",
          ["recipient@example.test"],
          "raw"
        )
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(fake.calls.sendMail).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("validates every envelope recipient before calling sendMail", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });
    await client.connect();

    try {
      await expect(
        client.send(
          "sender@example.test",
          [
            "recipient@example.test",
            "other@example.test\nRCPT TO:<evil@example.test>",
          ],
          "raw"
        )
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(fake.calls.sendMail).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("passes the validated envelope and raw message to sendMail", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });
    await client.connect();

    try {
      await client.send(
        " sender@example.test ",
        [" recipient@example.test ", "cc@example.test"],
        "Subject: raw\r\n\r\nbody"
      );
    } finally {
      await client.close();
    }

    expect(fake.calls.sendMail).toEqual([
      {
        envelope: {
          from: "sender@example.test",
          to: ["recipient@example.test", "cc@example.test"],
        },
        raw: "Subject: raw\r\n\r\nbody",
      },
    ]);
  });

  it("maps a sendMail rejection to InternalError", async () => {
    useMailer({ sendError: new Error("550 rejected") });
    const client = new SmtpClient({ host: "mail.example.test" });
    await client.connect();

    try {
      await expect(
        client.send("sender@example.test", ["recipient@example.test"], "raw")
      ).rejects.toThrow("SMTP delivery failed: 550 rejected");
      await expect(
        client.send("sender@example.test", ["recipient@example.test"], "raw")
      ).rejects.toBeInstanceOf(InternalError);
    } finally {
      await client.close();
    }
  });

  it("close() releases the transport and is idempotent", async () => {
    const fake = useMailer();
    const client = new SmtpClient({ host: "mail.example.test" });
    await client.connect();

    await client.close();
    await client.close();

    expect(fake.calls.close).toBe(1);
    await expect(
      client.send("sender@example.test", ["recipient@example.test"], "raw")
    ).rejects.toThrow("SMTP client is not connected");
  });

  it("reports InternalError with install guidance when nodemailer is missing", async () => {
    jest.resetModules();
    jest.unstable_unmockModule("nodemailer");
    jest.unstable_mockModule("nodemailer", () => {
      throw Object.assign(new Error("Cannot find package 'nodemailer'"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    });
    const fresh = (await import(
      "../../../src/comms/email/smtp"
    )) as SmtpModule;
    const freshErrors = (await import("@decaf-ts/db-decorators")) as typeof import("@decaf-ts/db-decorators");
    const client = new fresh.SmtpClient({ host: "mail.example.test" });

    await expect(client.connect()).rejects.toBeInstanceOf(
      freshErrors.InternalError
    );
    await expect(client.connect()).rejects.toThrow(/nodemailer/);
  });
});

interface CapturedMail {
  from: string;
  recipients: string[];
  raw: string;
}

interface CommandRecord {
  line: string;
  encrypted: boolean;
}

interface LocalSmtpStub {
  port: number;
  commands: CommandRecord[];
  messages: CapturedMail[];
  close(): Promise<void>;
}

interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  context: SecureContext;
}

function startSmtpSession(
  socket: Socket,
  commands: CommandRecord[],
  messages: CapturedMail[],
  alreadyEncrypted: boolean,
  tlsMaterial?: TlsMaterial
): void {
  let active: Socket = socket;
  let encrypted = alreadyEncrypted;
  let buffer = "";
  let from = "";
  let recipients: string[] = [];
  let inData = false;
  let data: string[] = [];
  let authStep = 0;

  const write = (reply: string, callback?: () => void) =>
    active.write(reply, callback);

  const handle = (line: string) => {
    commands.push({ line, encrypted });
    if (inData) {
      if (line === ".") {
        inData = false;
        messages.push({
          from,
          recipients: [...recipients],
          raw: data.join("\r\n"),
        });
        from = "";
        recipients = [];
        data = [];
        write("250 2.0.0 Queued\r\n");
      } else {
        data.push(line.startsWith("..") ? line.slice(1) : line);
      }
      return;
    }
    if (authStep > 0) {
      authStep += 1;
      if (authStep === 3) {
        authStep = 0;
        write("235 2.7.0 Authentication successful\r\n");
      } else {
        write("334 UGFzc3dvcmQ6\r\n");
      }
      return;
    }
    const command = line.split(" ")[0]?.toUpperCase();
    switch (command) {
      case "EHLO":
        write(
          encrypted
            ? "250-localhost\r\n250-AUTH LOGIN\r\n250 OK\r\n"
            : "250-localhost\r\n250-STARTTLS\r\n250-AUTH LOGIN\r\n250 OK\r\n"
        );
        break;
      case "STARTTLS":
        if (!tlsMaterial) {
          write("454 4.7.0 TLS not available\r\n");
          break;
        }
        write("220 2.0.0 Ready to start TLS\r\n", () => {
          active.removeAllListeners("data");
          const secured = new TLSSocket(active, {
            isServer: true,
            secureContext: tlsMaterial.context,
          });
          active = secured;
          encrypted = true;
          secured.on("error", () => secured.destroy());
          attach(secured);
        });
        break;
      case "AUTH":
        if (/^AUTH\s+LOGIN/i.test(line)) {
          authStep = 1;
          write("334 VXNlcm5hbWU6\r\n");
        } else {
          write("504 Unsupported authentication\r\n");
        }
        break;
      case "MAIL":
        from = /<([^>]*)>/.exec(line)?.[1] ?? "";
        write("250 2.1.0 OK\r\n");
        break;
      case "RCPT": {
        const match = /<([^>]*)>/.exec(line)?.[1];
        if (match) recipients.push(match);
        write("250 2.1.5 OK\r\n");
        break;
      }
      case "DATA":
        inData = true;
        write("354 End data with <CR><LF>.<CR><LF>\r\n");
        break;
      case "QUIT":
        write("221 2.0.0 Bye\r\n", () => socket.end());
        break;
      default:
        write("250 OK\r\n");
        break;
    }
  };

  function attach(target: Socket): void {
    target.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\r\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(line);
        index = buffer.indexOf("\r\n");
      }
    });
  }

  attach(socket);
  write("220 localhost ESMTP test stub\r\n");
}

async function startStartTlsStub(
  tlsMaterial: TlsMaterial
): Promise<LocalSmtpStub> {
  const commands: CommandRecord[] = [];
  const messages: CapturedMail[] = [];
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
    startSmtpSession(socket, commands, messages, false, tlsMaterial);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("SMTP stub did not expose a TCP port");
  }
  return {
    port: address.port,
    commands,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function startImplicitTlsStub(
  tlsMaterial: TlsMaterial
): Promise<LocalSmtpStub> {
  const commands: CommandRecord[] = [];
  const messages: CapturedMail[] = [];
  const sockets = new Set<Socket>();
  const server = createTlsServer(
    { key: tlsMaterial.key, cert: tlsMaterial.cert },
    (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => sockets.delete(socket));
      startSmtpSession(socket, commands, messages, true);
    }
  );
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("TLS SMTP stub did not expose a TCP port");
  }
  return {
    port: address.port,
    commands,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const opensslAvailable = (() => {
  const probe = spawnSync("openssl", ["version"], { encoding: "utf8" });
  return probe.status === 0;
})();

const tlsIt = opensslAvailable ? it : it.skip;

describe("SmtpClient STARTTLS and implicit TLS", () => {
  let certificateDir: string | undefined;
  let tlsMaterial: TlsMaterial;
  let SmtpClient: SmtpClientConstructor;

  beforeAll(async () => {
    if (!opensslAvailable) return;
    jest.resetModules();
    jest.unstable_unmockModule("nodemailer");
    ({ SmtpClient } = (await import(
      "../../../src/comms/email/smtp"
    )) as SmtpModule);
    certificateDir = mkdtempSync(join(tmpdir(), "smtp-client-test-"));
    const keyPath = join(certificateDir, "key.pem");
    const certPath = join(certificateDir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { stdio: "ignore" }
    );
    const key = readFileSync(keyPath);
    const cert = readFileSync(certPath);
    tlsMaterial = {
      key,
      cert,
      context: createSecureContext({ key, cert }),
    };
  });

  afterAll(() => {
    if (certificateDir) rmSync(certificateDir, { recursive: true, force: true });
  });

  tlsIt(
    "upgrades with STARTTLS and only authenticates after the encryption",
    async () => {
      const stub = await startStartTlsStub(tlsMaterial);
      const client = new SmtpClient({
        host: "127.0.0.1",
        port: stub.port,
        username: "sender@example.test",
        password: "secret",
        allowUnauthorizedCerts: true,
      });

      try {
        await client.connect();
        await client.send(
          "sender@example.test",
          ["recipient@example.test"],
          "From: sender@example.test\r\nTo: recipient@example.test\r\nSubject: starttls\r\n\r\nbody"
        );

        const startTlsIndex = stub.commands.findIndex((entry) =>
          /^STARTTLS$/i.test(entry.line)
        );
        const authEntries = stub.commands.filter((entry) =>
          /^AUTH\s+LOGIN/i.test(entry.line)
        );
        expect(startTlsIndex).toBeGreaterThanOrEqual(0);
        expect(authEntries.length).toBeGreaterThanOrEqual(1);
        const authIndex = stub.commands.indexOf(authEntries[0]);
        expect(authIndex).toBeGreaterThan(startTlsIndex);
        expect(authEntries.every((entry) => entry.encrypted)).toBe(true);
        expect(
          stub.commands
            .slice(0, authIndex)
            .some((entry) => /^AUTH/i.test(entry.line))
        ).toBe(false);
        expect(
          stub.commands
            .filter((entry) => /^MAIL FROM/i.test(entry.line))
            .every((entry) => entry.encrypted)
        ).toBe(true);
        expect(stub.messages).toHaveLength(1);
        expect(stub.messages[0].from).toBe("sender@example.test");
        expect(stub.messages[0].recipients).toEqual(["recipient@example.test"]);
        expect(stub.messages[0].raw).toContain("Subject: starttls");
      } finally {
        await client.close();
        await stub.close();
      }
    }
  );

  tlsIt(
    "authenticates immediately over implicit TLS when secure is true",
    async () => {
      const stub = await startImplicitTlsStub(tlsMaterial);
      const client = new SmtpClient({
        host: "127.0.0.1",
        port: stub.port,
        secure: true,
        username: "sender@example.test",
        password: "secret",
        allowUnauthorizedCerts: true,
      });

      try {
        await client.connect();
        await client.send(
          "sender@example.test",
          ["recipient@example.test"],
          "From: sender@example.test\r\nTo: recipient@example.test\r\nSubject: tls\r\n\r\nbody"
        );

        const authEntry = stub.commands.find((entry) =>
          /^AUTH\s+LOGIN/i.test(entry.line)
        );
        expect(authEntry).toBeDefined();
        expect(authEntry?.encrypted).toBe(true);
        expect(
          stub.commands.some((entry) => /^STARTTLS$/i.test(entry.line))
        ).toBe(false);
        expect(stub.messages).toHaveLength(1);
        expect(stub.messages[0].raw).toContain("Subject: tls");
      } finally {
        await client.close();
        await stub.close();
      }
    }
  );
});
