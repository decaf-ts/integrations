/**
 * @module integrations/comms/email/smtp
 * @summary SMTP client used by the Email service for direct SMTP delivery.
 * @description Delegates the SMTP protocol to the optional `nodemailer`
 * library (the same library n8n uses) instead of hand-rolling the wire
 * protocol: the transport performs EHLO, STARTTLS/implicit TLS, AUTH LOGIN,
 * and the `MAIL FROM`/`RCPT TO`/`DATA` transaction for a pre-built raw MIME
 * message. The public {@link SmtpClient} surface is unchanged. Envelope
 * addresses are validated through {@link assertEmailAddress} (decaf
 * `BadRequestError`s) before they reach any SMTP command, and credentials are
 * never sent over a plaintext session unless `SmtpConfig.allowPlaintextAuth`
 * opts in.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import type { SendMailOptions, Transporter } from "nodemailer";
import { assertEmailAddress } from "./mime";

/**
 * @description SMTP connection configuration
 * @summary Carries the server address, optional implicit-TLS/STARTTLS
 * selection, credentials, and timeouts.
 *
 * `secure` selects implicit TLS: `true` opens a TLS socket from the first byte
 * (default port 465). `false` connects in plaintext and upgrades with STARTTLS
 * when the server advertises it (default port 587). When credentials are
 * configured, `connect()` refuses to authenticate unless the session is
 * encrypted; `allowPlaintextAuth` is the explicit, documented opt-out for
 * servers that cannot offer TLS.
 * @category Comms
 * @memberOf module:integrations/comms/email/smtp
 */
export interface SmtpConfig {
  /** @description SMTP server hostname (required) */
  host: string;
  /** @description Server port; defaults to `465` when `secure` is `true`, `587` otherwise */
  port?: number;
  /** @description `true` opens an implicit-TLS socket from the first byte; `false` (default) connects in plaintext and upgrades via STARTTLS */
  secure?: boolean;
  /** @description Username for `AUTH LOGIN`; when set with `password`, enables the fail-closed plaintext-AUTH check */
  username?: string;
  /** @description Password for `AUTH LOGIN` */
  password?: string;
  /** @description Connection, greeting, and socket timeout in milliseconds (default `30000`) */
  timeout?: number;
  /** @description Explicitly permit `AUTH LOGIN` over a plaintext session (default `false`) */
  allowPlaintextAuth?: boolean;
  /** @description Explicitly accept an otherwise-invalid TLS certificate (default `false`) */
  allowUnauthorizedCerts?: boolean;
  /** @description Client hostname announced in `EHLO` (default `as-graph`) */
  clientHostname?: string;
}

/**
 * Structural view of the optional `nodemailer` module.
 *
 * Declared locally so this file never statically imports the optional peer;
 * the module is resolved with a dynamic import in {@link SmtpClient.connect}.
 */
interface NodemailerModule {
  createTransport(
    options: Record<string, unknown>,
    defaults?: Record<string, unknown>
  ): Transporter;
}

/**
 * @description SMTP client for raw MIME delivery
 * @summary Connects and authenticates through a nodemailer SMTP transport
 * (implicit TLS on `secure`, STARTTLS otherwise), then delivers a pre-built
 * message with the envelope sender/recipients and the raw RFC 5322 source.
 * Credentials are never sent over a plaintext session unless
 * `allowPlaintextAuth` is set, and every envelope address is validated before
 * it reaches the transport.
 * @category Comms
 * @memberOf module:integrations/comms/email/smtp
 * @example
 * ```ts
 * import { SmtpClient, buildEmail } from "@decaf-ts/integrations/comms/email";
 *
 * const client = new SmtpClient({
 *   host: "smtp.example.com",
 *   port: 587,
 *   username: "noreply@example.com",
 *   password: process.env.SMTP_PASSWORD,
 * });
 * await client.connect();
 * const mail = buildEmail({
 *   from: "noreply@example.com",
 *   to: ["ops@example.com"],
 *   subject: "Nightly report",
 *   text: "All systems nominal.",
 * });
 * await client.send(mail.from, mail.recipients, mail.raw);
 * await client.close();
 * ```
 */
export class SmtpClient {
  private transporter?: Transporter;

  /**
   * @description Creates an SMTP client
   * @summary Stores the config; the nodemailer transport is only created and
   * verified by {@link SmtpClient.connect}.
   * @param config - Server address, optional credentials, and TLS/timeout options
   */
  constructor(private config: SmtpConfig) {}

  private transportOptions(): Record<string, unknown> {
    const secure = this.config.secure ?? false;
    const hasCredentials = Boolean(
      this.config.username && this.config.password
    );
    const timeout = this.config.timeout ?? 30000;
    return {
      host: this.config.host,
      port: this.config.port ?? (secure ? 465 : 587),
      secure,
      name: this.config.clientHostname ?? "as-graph",
      requireTLS:
        !secure && hasCredentials && !this.config.allowPlaintextAuth,
      auth: hasCredentials
        ? {
            user: this.config.username,
            pass: this.config.password,
            method: "LOGIN",
          }
        : undefined,
      tls: this.config.allowUnauthorizedCerts
        ? { rejectUnauthorized: false }
        : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    };
  }

  private transportError(prefix: string, error: unknown): InternalError {
    if (error instanceof InternalError) return error;
    return new InternalError(
      `${prefix}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * @description Opens the SMTP session
   * @summary Lazily loads the optional `nodemailer` peer, builds the SMTP
   * transport for the configured host/credentials, and verifies it
   * (`EHLO` + TLS upgrade + `AUTH LOGIN` when credentials are configured).
   * Authentication fails closed: with credentials configured and no encrypted
   * session, the transport requires STARTTLS and verification fails unless
   * `allowPlaintextAuth` was set on the config.
   * @throws {InternalError} when `nodemailer` is not installed, or on
   * connection, TLS, or auth failures
   */
  async connect(): Promise<void> {
    if (this.transporter) return;
    const moduleName = "nodemailer";
    let module: NodemailerModule;
    try {
      module = (await import(moduleName)) as unknown as NodemailerModule;
    } catch {
      throw new InternalError(
        "SMTP delivery requires the optional 'nodemailer' package; install it to use this surface"
      );
    }
    if (typeof module.createTransport !== "function") {
      throw new InternalError(
        "The optional 'nodemailer' package did not export createTransport"
      );
    }
    const transporter = module.createTransport(this.transportOptions(), {
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transporter.verify();
    } catch (error) {
      transporter.close();
      throw this.transportError("SMTP connection failed", error);
    }
    this.transporter = transporter;
  }

  /**
   * @description Delivers a raw message over the established session
   * @summary Validates the envelope, then hands the sender, recipients, and
   * raw RFC 5322 source to nodemailer's `sendMail` (the transport performs
   * queueing, dot-stuffing, and CRLF normalization).
   * @param from - Envelope sender address
   * @param recipients - Envelope recipient addresses
   * @param raw - Raw RFC 5322 message text
   * @throws {InternalError} when not connected or the server rejects delivery
   * @throws {BadRequestError} when the envelope sender or a recipient is not an allowlisted mailbox
   */
  async send(from: string, recipients: string[], raw: string): Promise<void> {
    if (!this.transporter) {
      throw new InternalError("SMTP client is not connected");
    }
    const sender = assertEmailAddress(from, "envelope sender");
    const envelopes = recipients.map((recipient) =>
      assertEmailAddress(recipient, "envelope recipient")
    );
    const message: SendMailOptions = {
      envelope: { from: sender, to: envelopes },
      raw,
    };
    try {
      await this.transporter.sendMail(message);
    } catch (error) {
      throw this.transportError("SMTP delivery failed", error);
    }
  }

  /**
   * @description Closes the session gracefully
   * @summary Closes the nodemailer transport, ignoring shutdown failures.
   */
  async close(): Promise<void> {
    try {
      this.transporter?.close();
    } finally {
      this.transporter = undefined;
    }
  }
}
