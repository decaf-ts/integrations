/**
 * @module integrations/comms/email/service
 * @summary Email integration service for sending mail and reading inboxes across SMTP, Microsoft Graph, and IMAP.
 * @description Exposes a decaf `@service("email")` client-based service that
 * multiplexes three delivery surfaces behind one config: SMTP delivery through
 * the built-in {@link SmtpClient} (raw MIME built by {@link buildEmail}), and
 * Microsoft Graph (`sendMail`, message listing) through {@link HttpApiService}
 * with a bearer token. `listInbox` reads via Graph while `listImapMessages`
 * dynamically imports the optional `imapflow` package for direct IMAP reads.
 * Configuration comes from an explicit {@link EmailServiceConfig} or the
 * `comms.email` environment slice; failures are mapped to decaf errors via
 * {@link httpError} (Graph) or wrapped `InternalError`s (SMTP).
 */
import { service } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { CommsEnvironment } from "../environment";
import {
  envBoolean,
  envNumber,
  envString,
} from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";
import { SmtpClient } from "./smtp";
import {
  buildEmail,
  parseAddressList,
  type EmailMessageInput,
} from "./mime";

/**
 * @description Delivery provider selected for a send
 * @summary `smtp` delivers through the built-in raw-MIME client; `graph`
 * posts to the Microsoft Graph `sendMail` endpoint.
 * @category Comms
 * @memberOf module:integrations/comms/email/service
 */
export type EmailProvider = "smtp" | "graph";

/**
 * @description Configuration for the Email service
 * @summary Extends {@link HttpApiServiceConfig} with the SMTP connection
 * settings and the Microsoft Graph token/base URL. Every field falls back to
 * the `comms.email` environment slice when omitted. A `host` selects the SMTP
 * provider; a `token` (without `host`) selects Graph.
 * @category Comms
 * @memberOf module:integrations/comms/email/service
 */
export interface EmailServiceConfig extends HttpApiServiceConfig {
  provider?: EmailProvider;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from?: string;
  graphBaseUrl?: string;
  token?: string;
}

/**
 * @description Result of a successful email send
 * @summary Carries the generated RFC 5322 `Message-ID`, the resolved sender,
 * the flattened recipient list, and the provider that delivered it.
 * @category Comms
 * @memberOf module:integrations/comms/email/service
 */
export interface EmailSendResult {
  /** @description Generated `Message-ID` (also present in the raw MIME headers) */
  messageId: string;
  /** @description Sender address used for delivery */
  from: string;
  /** @description All To/Cc/Bcc recipients, in that order */
  recipients: string[];
  /** @description Provider that performed the delivery */
  provider: EmailProvider;
}

/**
 * @description Filter for inbox reads
 * @summary Applies to both {@link EmailService.listInbox} (Graph) and
 * {@link EmailService.listImapMessages} (IMAP): mailbox path, page size, a
 * lower received-date bound, and a subject filter.
 * @category Comms
 * @memberOf module:integrations/comms/email/service
 */
export interface EmailInboxQuery {
  /** @description Mailbox path to read (default `me` on Graph, `INBOX` on IMAP) */
  mailbox?: string;
  /** @description Maximum messages returned (default 25) */
  limit?: number;
  /** @description Only messages received after this date (Graph `$filter`) */
  since?: string;
  /** @description Subject `contains` filter (Graph only) */
  subject?: string;
}

/**
 * @description Multi-provider email send/inbox service
 * @summary Resolves the delivery provider from config (`provider`, or inferred
 * from the presence of `host` vs `token`), builds RFC 5322 MIME with
 * UTF-8-encoded headers via {@link buildEmail}, then delivers through SMTP or
 * posts to Graph. Inbox reads go through Graph `messages` (with `$top`,
 * `$filter`, `$orderby`) or the optional `imapflow` package.
 * @category Comms
 * @memberOf module:integrations/comms/email/service
 */
@service("email")
export class EmailService extends HttpApiService<EmailServiceConfig> {
  protected readonly serviceName = "Email";

  /**
   * @description Default Microsoft Graph base URL used when no override is configured
   * @returns The Graph v1.0 endpoint URL
   */
  protected defaultBaseUrl(): string {
    return "https://graph.microsoft.com/v1.0";
  }

  /**
   * @description Authorization headers for Graph requests
   * @param config - Resolved service config
   * @returns A bearer-token `Authorization` header map, empty when no `token` is configured
   */
  protected authHeaders(config: EmailServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Builds service config from the `comms.email` environment slice
   * @returns A partial config when either an SMTP `host` or a Graph `token` is present, otherwise `undefined`
   */
  protected configFromEnvironment(): Partial<EmailServiceConfig> | undefined {
    const env = CommsEnvironment.comms.email;
    const host = envString(env?.host);
    const token = envString(env?.token);
    if (!host && !token) return undefined;
    const provider = envString(env.provider) as EmailProvider | undefined;
    return {
      provider: provider ?? (host ? "smtp" : "graph"),
      host,
      port: envNumber(env.port),
      secure: envBoolean(env.secure),
      username: envString(env.username),
      password: envString(env.password),
      from: envString(env.from),
      token,
      graphBaseUrl: envString(env.graphBaseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Selects the delivery provider
   * @summary Prefers an explicit `provider`, then infers `smtp` from a
   * configured `host` and `graph` from a configured `token`.
   * @param config - Resolved service config
   * @returns The resolved provider
   * @throws {InternalError} when neither an SMTP host nor a Graph token is configured
   */
  protected resolveProvider(config: EmailServiceConfig): EmailProvider {
    if (config.provider) return config.provider;
    if (config.host) return "smtp";
    if (config.token) return "graph";
    throw new InternalError(
      "Email requires either an SMTP host or a Microsoft Graph token"
    );
  }

  /**
   * @description Resolves the fallback sender address
   * @summary Uses `from`, then `username`, then the `From` header override.
   * @param config - Resolved service config
   * @returns The resolved sender address
   * @throws {InternalError} when no sender address can be resolved
   */
  protected resolveFrom(config: EmailServiceConfig): string {
    const from =
      config.from ?? config.username ?? config.headers?.["From"] ?? undefined;
    if (!from) throw new InternalError("Email requires a sender address");
    return from;
  }

  /**
   * @description Sends an email through the resolved provider
   * @summary Builds the raw MIME message (honouring `input.from`, else the
   * resolved config sender), then delivers via SMTP or Graph.
   * @param input - Message input (recipients, subject, text/html body, attachments)
   * @returns The send result with the generated `Message-ID` and provider
   * @throws {InternalError} when the provider cannot be resolved, the SMTP host is missing, or SMTP delivery fails
   */
  async send(input: EmailMessageInput): Promise<EmailSendResult> {
    const config = this.config;
    const provider = this.resolveProvider(config);
    const from = input.from || this.resolveFrom(config);
    const built = buildEmail({ ...input, from });
    if (provider === "graph") {
      await this.sendViaGraph(built.raw, from);
      return {
        messageId: built.messageId,
        from,
        recipients: built.recipients,
        provider,
      };
    }
    if (!config.host) {
      throw new InternalError("Email SMTP provider requires a host");
    }
    const client = new SmtpClient({
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      password: config.password,
      timeout: config.timeout,
    });
    try {
      await client.connect();
      await client.send(built.from, built.recipients, built.raw);
      return {
        messageId: built.messageId,
        from,
        recipients: built.recipients,
        provider,
      };
    } catch (error) {
      if (error instanceof InternalError) throw error;
      throw new InternalError(
        `Email SMTP delivery failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /**
   * @description Posts a raw MIME message to the Microsoft Graph `sendMail` endpoint
   * @summary Sends the base64-encoded raw message to
   * `/users/<from>/sendMail` (or `/me/sendMail` when no sender is resolved)
   * with the configured `graphBaseUrl`/`baseUrl`.
   * @param raw - Raw RFC 5322 message text
   * @param from - Sender mailbox (UPN) for the Graph path
   * @throws {Error} Graph error mapped through {@link httpError}
   */
  protected async sendViaGraph(raw: string, from: string): Promise<void> {
    const config = this.config;
    this.requireToken(config);
    const baseUrl =
      config.graphBaseUrl ??
      config.baseUrl ??
      "https://graph.microsoft.com/v1.0";
    const path = from
      ? `/users/${encodeURIComponent(from)}/sendMail`
      : "/me/sendMail";
    try {
      await this.client.post(`${baseUrl}${path}`, Buffer.from(raw, "utf8").toString("base64"), {
        headers: { "Content-Type": "text/plain" },
      });
    } catch (error) {
      throw httpError("Microsoft Graph", "sendMail", error);
    }
  }

  /**
   * @description Lists messages from a Graph mailbox
   * @summary Queries `<mailbox>/messages` with `$top`, an optional
   * subject/since `$filter`, and `receivedDateTime desc` ordering.
   * @param query - Inbox filter (mailbox, limit, since, subject)
   * @returns The raw Graph message records
   * @throws {InternalError} when no `token` is configured; Graph errors mapped through {@link httpError}
   */
  async listInbox(
    query: EmailInboxQuery = {}
  ): Promise<Array<Record<string, unknown>>> {
    const config = this.config;
    this.requireToken(config);
    const baseUrl =
      config.graphBaseUrl ??
      config.baseUrl ??
      "https://graph.microsoft.com/v1.0";
    const mailbox = query.mailbox ?? "me";
    const filters = [
      query.subject ? `contains(subject,'${query.subject}')` : undefined,
      query.since ? `receivedDateTime ge ${query.since}` : undefined,
    ].filter(Boolean);
    try {
      const response = await this.client.get<{
        value?: Array<Record<string, unknown>>;
      }>(`${baseUrl}/${mailbox}/messages`, {
        params: {
          $top: query.limit ?? 25,
          $filter: filters.length ? filters.join(" and ") : undefined,
          $orderby: "receivedDateTime desc",
        },
      });
      return response.data.value ?? [];
    } catch (error) {
      throw httpError("Microsoft Graph", "list messages", error);
    }
  }

  /**
   * @description Lists messages directly over IMAP
   * @summary Dynamically imports the optional `imapflow` package, connects to
   * `host` (default port 993, implicit TLS), and fetches the newest messages
   * from `INBOX`.
   * @param query - Inbox filter (limit only is honoured by IMAP)
   * @returns The fetched IMAP message records
   * @throws {InternalError} when `imapflow` is not installed, no `host` is configured, or the IMAP session fails
   */
  async listImapMessages(
    query: EmailInboxQuery = {}
  ): Promise<Array<Record<string, unknown>>> {
    let ImapFlow: unknown;
    try {
      const moduleName = "imapflow";
      const imported = (await import(moduleName)) as {
        ImapFlow?: unknown;
      };
      ImapFlow = imported.ImapFlow;
      if (!ImapFlow) throw new Error("imapflow did not export ImapFlow");
    } catch {
      throw new InternalError(
        "IMAP reads require the optional 'imapflow' package; install it to use this surface"
      );
    }
    const config = this.config;
    if (!config.host) throw new InternalError("IMAP requires a host");
    const client = new (ImapFlow as new (options: unknown) => {
      connect(): Promise<void>;
      logout(): Promise<void>;
      getMailboxLock(path: string): Promise<{ release(): void }>;
      fetch(
        range: string,
        fields: unknown,
        options: unknown
      ): AsyncIterable<Record<string, unknown>>;
    })({
      host: config.host,
      port: config.port ?? 993,
      secure: config.secure ?? true,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });
    const messages: Array<Record<string, unknown>> = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const limit = query.limit ?? 25;
        for await (const message of client.fetch(
          `${Math.max(1, limit)}:*`,
          { envelope: true, source: false },
          { uid: false }
        )) {
          messages.push(message);
          if (messages.length >= limit) break;
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return messages;
  }
}
