/**
 * @module integrations/comms/gmail/service
 * @summary Gmail API integration service for sending and listing messages.
 * @description Exposes the Gmail REST API (`users.messages.send`,
 * `users.messages.list`, `users.messages.get`, `users.labels.list`) as an
 * undecorated client-based service built on {@link HttpApiService}.
 * Message sending reuses the shared MIME builder from the email integration
 * (`buildEmail`) and posts the raw MIME message as base64url. Configuration
 * comes from an explicit `GmailServiceConfig` or the `comms.gmail` environment
 * slice, and failures are mapped to decaf errors via {@link httpError}.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { CommsEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";
import { buildEmail, type EmailMessageInput } from "../email/mime";

/**
 * @description Configuration for the Gmail service
 * @summary Extends {@link HttpApiServiceConfig} with the OAuth access token
 * (sent as a bearer token) and the mailbox `userId` used in the API path
 * (defaults to `"me"`). When omitted, the `comms.gmail` environment slice
 * supplies the token (and optional `userId`, `baseUrl`, `timeout`).
 * @category Comms
 * @memberOf module:integrations/comms/gmail/service
 */
export interface GmailServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Gmail API OAuth access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
  /**
   * @description Mailbox user identifier
   * @summary The special value `"me"` (the default) refers to the authenticated user.
   */
  userId?: string;
}

/**
 * @description Result of a sent Gmail message
 * @summary Echoes Gmail's identifiers for the sent message: the message `id`,
 * its `threadId` when Gmail assigned one, and the applied `labelIds`.
 * @category Comms
 * @memberOf module:integrations/comms/gmail/service
 */
export interface GmailSendResult {
  id: string;
  threadId?: string;
  labelIds?: string[];
}

/**
 * @description Result of a Gmail message list call
 * @summary Carries one page of message references (`messages` with `id` and
 * optional `threadId`), the `nextPageToken` to pass back as `pageToken` for
 * the next page, and Gmail's `resultSizeEstimate`.
 * @category Comms
 * @memberOf module:integrations/comms/gmail/service
 */
export interface GmailListResult {
  messages: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * @description Gmail API integration service
 * @summary An undecorated HTTP service for sending MIME-built
 * emails, listing messages with Gmail query syntax and page tokens, fetching
 * a single message in a chosen format, and listing labels. All operations
 * require an OAuth token (`requireToken()`) and operate on the configured
 * `userId` mailbox (default `"me"`); transport failures are mapped to decaf
 * errors via {@link httpError}.
 * @class GmailService
 * @category Comms
 * @example
 * ```ts
 * import { GmailService } from "@decaf-ts/integrations/comms/gmail";
 *
 * const gmail = new GmailService();
 * await gmail.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_GMAIL_TOKEN,
 * });
 * await gmail.send({
 *   from: "bot@example.com",
 *   to: "ops@example.com",
 *   subject: "Deploy",
 *   text: "Release 1.2.0 is live",
 * });
 * ```
 * @memberOf module:integrations/comms/gmail/service
 */
export class GmailService extends HttpApiService<GmailServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Gmail";

  /**
   * @description The Gmail REST API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://gmail.googleapis.com/gmail/v1"`.
   */
  protected defaultBaseUrl(): string {
    return "https://gmail.googleapis.com/gmail/v1";
  }

  /**
   * @description Builds the Gmail OAuth bearer authorization headers
   * @summary Returns the `Authorization: Bearer <token>` header when the
   * config carries a token, and no headers otherwise.
   * @param {GmailServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: GmailServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Gmail credentials and defaults from the environment
   * @summary Reads the `comms.gmail` environment slice and returns a partial
   * config when a token is configured, `undefined` otherwise. Values pass
   * through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<GmailServiceConfig> | undefined} A partial config, or `undefined` when no Gmail token is configured.
   */
  protected configFromEnvironment(): Partial<GmailServiceConfig> | undefined {
    const env = CommsEnvironment.comms.gmail;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      userId: envString(env.userId),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Builds the mailbox-scoped API path
   * @summary Returns `/users/<userId>` with the configured `userId` (or
   * `"me"` when unset) URL-encoded; all message and label operations are
   * relative to this path.
   * @returns {string} The URL-encoded mailbox path.
   */
  protected userPath(): string {
    return `/users/${encodeURIComponent(this.config.userId ?? "me")}`;
  }

  /**
   * @description Sends an email through the Gmail API
   * @summary Builds a raw MIME message from the input with the shared email
   * MIME builder (`buildEmail`), base64url-encodes it, and `POST`s it to
   * `users.messages.send`. Requires a token and a `from` sender address.
   * @param {EmailMessageInput} input - The message envelope and body (`from`, `to`, `subject`, and optional `cc`/`bcc`/`text`/`html`/`replyTo`/`attachments`).
   * @returns {Promise<GmailSendResult>} Gmail's identifiers for the sent message.
   * @throws {InternalError} When no token is configured or the sender address is missing.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When Gmail answers with HTTP 409.
   * @throws {BadRequestError} When Gmail answers with any other HTTP error status (e.g. invalid recipients).
   */
  async send(input: EmailMessageInput): Promise<GmailSendResult> {
    this.requireToken();
    if (!input.from) {
      throw new InternalError("Gmail send requires a sender address");
    }
    const built = buildEmail(input);
    try {
      const response = await this.client.post<{
        id?: string;
        threadId?: string;
        labelIds?: string[];
      }>(`${this.userPath()}/messages/send`, {
        raw: Buffer.from(built.raw, "utf8").toString("base64url"),
      });
      return {
        id: String(response.data.id ?? built.messageId),
        threadId: response.data.threadId,
        labelIds: response.data.labelIds,
      };
    } catch (error) {
      throw httpError("Gmail", "send message", error);
    }
  }

  /**
   * @description Lists mailbox messages with Gmail query paging
   * @summary `GET`s `users.messages.list` with an optional Gmail `query`
   * (`q` parameter, e.g. `"from:user@example.com is:unread"`), a page size
   * (default `25`), a `pageToken` from the previous page, and `labelIds`
   * filtering. Returns the message references and the `nextPageToken` to pass
   * back as `pageToken` for the next page.
   * @param {object} [options] - Query and paging options.
   * @param {string} [options.query] - Gmail search query (`q` parameter).
   * @param {number} [options.maxResults] - Page size; defaults to `25`.
   * @param {string} [options.pageToken] - The `nextPageToken` from the previous page.
   * @param {string[]} [options.labelIds] - Label IDs the messages must carry.
   * @returns {Promise<GmailListResult>} One page of message references with the next page token when more pages exist.
   * @throws {InternalError} When no token is configured.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When Gmail answers with HTTP 409.
   * @throws {BadRequestError} When Gmail answers with any other HTTP error status (e.g. invalid query).
   * @example
   * ```ts
   * let pageToken: string | undefined;
   * do {
   *   const page = await gmail.listMessages({
   *     query: "is:unread",
   *     maxResults: 100,
   *     pageToken,
   *   });
   *   console.log(page.messages);
   *   pageToken = page.nextPageToken;
   * } while (pageToken);
   * ```
   */
  async listMessages(
    options: {
      query?: string;
      maxResults?: number;
      pageToken?: string;
      labelIds?: string[];
    } = {}
  ): Promise<GmailListResult> {
    this.requireToken();
    try {
      const response = await this.client.get<{
        messages?: Array<{ id: string; threadId?: string }>;
        nextPageToken?: string;
        resultSizeEstimate?: number;
      }>(`${this.userPath()}/messages`, {
        params: {
          q: options.query,
          maxResults: options.maxResults ?? 25,
          pageToken: options.pageToken,
          labelIds: options.labelIds,
        },
      });
      return {
        messages: response.data.messages ?? [],
        nextPageToken: response.data.nextPageToken,
        resultSizeEstimate: response.data.resultSizeEstimate,
      };
    } catch (error) {
      throw httpError("Gmail", "list messages", error);
    }
  }

  /**
   * @description Fetches a single Gmail message
   * @summary `GET`s `users.messages.get` for the given message ID with the
   * requested `format`. With `"full"` (the default) the payload includes the
   * parsed body parts; `"metadata"` limits it to headers and labels,
   * `"minimal"` to identifiers only, and `"raw"` returns the raw MIME string.
   * @param {string} id - The Gmail message ID.
   * @param {"full" | "metadata" | "minimal" | "raw"} [format] - The message format to request; defaults to `"full"`.
   * @returns {Promise<Record<string, unknown>>} The raw Gmail message payload in the requested format.
   * @throws {InternalError} When no token is configured or the message ID is empty.
   * @throws {NotFoundError} When the message does not exist (HTTP 404).
   * @throws {ConflictError} When Gmail answers with HTTP 409.
   * @throws {BadRequestError} When Gmail answers with any other HTTP error status.
   */
  async getMessage(
    id: string,
    format: "full" | "metadata" | "minimal" | "raw" = "full"
  ): Promise<Record<string, unknown>> {
    this.requireToken();
    if (!id) throw new InternalError("Gmail getMessage requires a message ID");
    try {
      const response = await this.client.get<Record<string, unknown>>(
        `${this.userPath()}/messages/${encodeURIComponent(id)}`,
        { params: { format } }
      );
      return response.data;
    } catch (error) {
      throw httpError("Gmail", "get message", error);
    }
  }

  /**
   * @description Lists the mailbox's Gmail labels
   * @summary `GET`s `users.labels.list` and returns the raw label payloads
   * (including `id`, `name`, and `type`).
   * @returns {Promise<Array<Record<string, unknown>>>} The raw Gmail label payloads.
   * @throws {InternalError} When no token is configured.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When Gmail answers with HTTP 409.
   * @throws {BadRequestError} When Gmail answers with any other HTTP error status.
   */
  async listLabels(): Promise<Array<Record<string, unknown>>> {
    this.requireToken();
    try {
      const response = await this.client.get<{
        labels?: Array<Record<string, unknown>>;
      }>(`${this.userPath()}/labels`);
      return response.data.labels ?? [];
    } catch (error) {
      throw httpError("Gmail", "list labels", error);
    }
  }
}
