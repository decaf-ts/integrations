/**
 * @module integrations/comms/email/smtp
 * @summary Minimal SMTP client used by the Email service for direct SMTP delivery.
 * @description Implements just enough of the SMTP protocol (RFC 5321) to
 * deliver a pre-built raw MIME message: plain or implicit-TLS connect
 * (defaulting to STARTTLS upgrade on port 587), `EHLO` greeting, optional
 * `AUTH LOGIN`, `MAIL FROM`/`RCPT TO`/`DATA` transaction with dot-stuffing,
 * and a graceful `QUIT`. Responses are parsed line-wise by {@link SmtpReader};
 * protocol violations and transport failures surface as decaf
 * `InternalError`s.
 */
import net from "node:net";
import tls from "node:tls";
import { InternalError } from "@decaf-ts/db-decorators";

/**
 * @description SMTP connection configuration
 * @summary Carries the server address, optional implicit-TLS/STARTTLS
 * selection, credentials, and timeouts.
 * @category Comms
 * @memberOf module:integrations/comms/email/smtp
 */
export interface SmtpConfig {
  host: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  timeout?: number;
}

/** A parsed SMTP server reply: 3-digit code plus the collected text lines. */
interface SmtpResponse {
  code: number;
  text: string;
}

/**
 * Line-buffered SMTP reply reader.
 *
 * Splits incoming socket data on newlines and waits until a final reply line
 * (`<3 digits> <space>`) appears, supporting multi-line replies; socket close
 * or error states fail pending reads instead of hanging.
 */
class SmtpReader {
  private buffer = "";

  private lines: string[] = [];

  private closed = false;

  private error?: Error;

  private waiters: Array<() => void> = [];

  constructor(private socket: net.Socket | tls.TLSSocket) {
    this.attach(socket);
  }

  /** Binds the reader to a (possibly upgraded) socket, resetting line state. */
  attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        this.lines.push(this.buffer.slice(0, index).replace(/\r$/, ""));
        this.buffer = this.buffer.slice(index + 1);
        index = this.buffer.indexOf("\n");
      }
      this.flush();
    });
    socket.on("close", () => {
      this.closed = true;
      this.flush();
    });
    socket.on("error", (error: Error) => {
      this.error = error;
      this.closed = true;
      this.flush();
    });
  }

  private flush(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /** Waits for the next complete SMTP reply (multi-line aware) or fails on close/error. */
  async response(): Promise<SmtpResponse> {
    for (;;) {
      const index = this.lines.findIndex((line) => /^\d{3} /.test(line));
      if (index >= 0) {
        const collected = this.lines.splice(0, index + 1);
        const final = collected[collected.length - 1];
        return { code: Number(final.slice(0, 3)), text: collected.join("\n") };
      }
      if (this.error) {
        throw new InternalError(`SMTP connection error: ${this.error.message}`);
      }
      if (this.closed) {
        throw new InternalError("SMTP connection closed prematurely");
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

/**
 * @description Minimal SMTP client for raw MIME delivery
 * @summary Connects (implicit TLS on `secure`, otherwise STARTTLS when
 * advertised), authenticates with `AUTH LOGIN` when credentials are set, and
 * performs the envelope + DATA transaction for a pre-built message.
 * @category Comms
 * @memberOf module:integrations/comms/email/smtp
 */
export class SmtpClient {
  private socket?: net.Socket | tls.TLSSocket;

  private reader?: SmtpReader;

  constructor(private config: SmtpConfig) {}

  private async command(text: string, expected: number[]): Promise<SmtpResponse> {
    if (!this.socket || !this.reader) {
      throw new InternalError("SMTP client is not connected");
    }
    this.socket.write(`${text}\r\n`);
    const response = await this.reader.response();
    if (!expected.includes(response.code)) {
      throw new InternalError(
        `SMTP command '${text.split(" ")[0]}' failed (${response.code}): ${
          response.text
        }`
      );
    }
    return response;
  }

  /**
   * @description Opens the SMTP session
   * @summary Connects (with timeout), validates the 220 greeting, sends
   * `EHLO`, upgrades to TLS via STARTTLS when available and not already
   * secure, and performs `AUTH LOGIN` when username/password are configured.
   * @throws {InternalError} on connection, greeting, capability, or auth failures
   */
  async connect(): Promise<void> {
    const host = this.config.host;
    const port = this.config.port ?? (this.config.secure ? 465 : 587);
    const socket = this.config.secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    socket.setTimeout(this.config.timeout ?? 30000);
    socket.once("timeout", () => socket.destroy(new Error("SMTP timeout")));
    await new Promise<void>((resolve, reject) => {
      socket.once(this.config.secure ? "secureConnect" : "connect", () =>
        resolve()
      );
      socket.once("error", reject);
    });
    this.socket = socket;
    this.reader = new SmtpReader(socket);
    const greeting = await this.reader.response();
    if (greeting.code !== 220) {
      throw new InternalError(
        `SMTP server rejected connection (${greeting.code}): ${greeting.text}`
      );
    }
    await this.command("EHLO as-graph", [250]);
    if (!this.config.secure) {
      const capabilities = await this.command("EHLO as-graph", [250]);
      if (/STARTTLS/i.test(capabilities.text)) {
        await this.command("STARTTLS", [220]);
        const upgraded = tls.connect({ socket, servername: host });
        await new Promise<void>((resolve, reject) => {
          upgraded.once("secureConnect", () => resolve());
          upgraded.once("error", reject);
        });
        this.socket = upgraded;
        this.reader.attach(upgraded);
        await this.command("EHLO as-graph", [250]);
      }
    }
    if (this.config.username && this.config.password) {
      await this.command("AUTH LOGIN", [334]);
      await this.command(
        Buffer.from(this.config.username, "utf8").toString("base64"),
        [334]
      );
      await this.command(
        Buffer.from(this.config.password, "utf8").toString("base64"),
        [235]
      );
    }
  }

  /**
   * @description Delivers a raw message over the established session
   * @summary Issues `MAIL FROM`, one `RCPT TO` per recipient, `DATA`, and
   * writes the message with dot-stuffing and CRLF normalization.
   * @param from - Envelope sender address
   * @param recipients - Envelope recipient addresses
   * @param raw - Raw RFC 5322 message text
   * @throws {InternalError} when not connected or the server rejects any step
   */
  async send(from: string, recipients: string[], raw: string): Promise<void> {
    await this.command(`MAIL FROM:<${from}>`, [250]);
    for (const recipient of recipients) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await this.command("DATA", [354]);
    const normalized = raw.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    if (!this.socket) throw new InternalError("SMTP client is not connected");
    this.socket.write(`${normalized}\r\n.\r\n`);
    const response = await this.reader!.response();
    if (response.code !== 250) {
      throw new InternalError(
        `SMTP server rejected message (${response.code}): ${response.text}`
      );
    }
  }

  /**
   * @description Closes the session gracefully
   * @summary Sends `QUIT` (ignoring shutdown failures) and destroys the socket.
   */
  async close(): Promise<void> {
    if (!this.socket) return;
    try {
      this.socket.write("QUIT\r\n");
      await this.reader?.response();
    } catch {
      // ignore shutdown failures
    }
    this.socket.destroy();
    this.socket = undefined;
    this.reader = undefined;
  }
}
