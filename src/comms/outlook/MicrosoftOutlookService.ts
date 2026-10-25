/**
 * @module integrations/comms/outlook/service
 * @summary Microsoft Outlook mail and calendar integration service (Microsoft Graph).
 * @description Exposes Outlook mail (`sendMail`, `listMessages`, `getMessage`)
 * and calendar (`listEvents`, `createEvent`, `deleteEvent`) operations through
 * Microsoft Graph `v1.0` as an undecorated client-based service built on
 * {@link HttpApiService}. Configuration comes from an explicit
 * `OutlookServiceConfig` or the `comms.outlook` environment slice; the access
 * token is sent as `Authorization: Bearer <token>`. Credentials are referenced
 * from configuration (and, from as-graph nodes, from the resolved
 * `microsoft-outlook` credential secret) and are never embedded in source.
 * Failures are mapped to decaf errors via {@link httpError}.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { CommsEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the Microsoft Outlook service
 * @summary Extends {@link HttpApiServiceConfig} with the Microsoft Graph
 * access token sent as a bearer token. When omitted, the `comms.outlook`
 * environment slice supplies the token (plus optional `baseUrl`/`timeout`).
 * @category Comms
 * @memberOf module:integrations/comms/outlook/service
 */
export interface OutlookServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Microsoft Graph access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
}

/**
 * @description Outlook recipient addresses
 * @summary Primary, carbon-copy, and blind-carbon-copy recipients. Each field
 * accepts a single address or an array (or comma/semicolon-separated list) of
 * addresses.
 * @category Comms
 * @memberOf module:integrations/comms/outlook/service
 */
export interface OutlookRecipients {
  /**
   * @description Primary recipient address(es)
   */
  to: string | string[];
  /**
   * @description Carbon-copy address(es)
   */
  cc?: string | string[];
  /**
   * @description Blind-carbon-copy address(es)
   */
  bcc?: string | string[];
}

/**
 * @description Input for sending an Outlook mail message
 * @summary Carries the recipients, `subject`, body, body content type, and
 * whether the message is saved to the Sent Items folder (default `true`).
 * @category Comms
 * @memberOf module:integrations/comms/outlook/service
 */
export interface OutlookMailInput extends OutlookRecipients {
  /**
   * @description Mail subject line
   */
  subject: string;
  /**
   * @description Mail body
   */
  body: string;
  /**
   * @description Body content type (default `"Text"`)
   */
  contentType?: "Text" | "HTML";
  /**
   * @description Whether the sent message is saved to Sent Items (default `true`)
   */
  saveToSentItems?: boolean;
}

/**
 * @description Options for listing Outlook messages or calendar events
 * @summary Carries the optional mail `folderId` (default `inbox`) plus the
 * OData `top`, `filter`, and `search` parameters. `folderId` is ignored by
 * `listEvents`.
 * @category Comms
 * @memberOf module:integrations/comms/outlook/service
 */
export interface OutlookListInput {
  /**
   * @description Mail folder ID to list from (default `inbox`)
   */
  folderId?: string;
  /**
   * @description Maximum number of results (`$top`)
   */
  top?: number;
  /**
   * @description OData filter expression (`$filter`)
   */
  filter?: string;
  /**
   * @description OData search expression (`$search`)
   */
  search?: string;
}

/**
 * @description Input for creating an Outlook calendar event
 * @summary Carries the `subject`, start and end timestamps, optional time
 * zone (default `UTC`), body, location, and required attendee addresses.
 * @category Comms
 * @memberOf module:integrations/comms/outlook/service
 */
export interface OutlookEventInput {
  /**
   * @description Event subject
   */
  subject: string;
  /**
   * @description Event start date-time (ISO 8601)
   */
  start: string;
  /**
   * @description Event end date-time (ISO 8601)
   */
  end: string;
  /**
   * @description IANA time zone for `start`/`end` (default `UTC`)
   */
  timeZone?: string;
  /**
   * @description Event body text
   */
  body?: string;
  /**
   * @description Event location display name
   */
  location?: string;
  /**
   * @description Required attendee address(es)
   */
  attendees?: string | string[];
}

/**
 * @description Normalizes Outlook recipient addresses into Graph recipients
 * @summary Accepts a single address, an array, or a comma/semicolon-separated
 * string, trims entries, drops blanks, and maps each address to the Graph
 * `{ emailAddress: { address } }` envelope.
 * @param {string | string[] | undefined} value - The raw recipient value.
 * @returns {Array<{ emailAddress: { address: string } }>} The Graph recipient envelopes.
 */
function recipientList(
  value: string | string[] | undefined
): Array<{ emailAddress: { address: string } }> {
  if (!value) return [];
  const values = Array.isArray(value)
    ? value
    : value.split(/[,;]/).map((entry) => entry.trim());
  return values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((address) => ({ emailAddress: { address } }));
}

/**
 * @description Microsoft Outlook (Graph) mail and calendar integration service
 * @summary An undecorated HTTP service for sending and reading mail and for
 * listing, creating, and deleting calendar events on the signed-in user
 * (`/me`). Every operation requires a Graph access token; missing credentials
 * or identifiers raise `InternalError`, and transport failures are mapped to
 * decaf errors via {@link httpError}.
 * @class MicrosoftOutlookService
 * @extends HttpApiService
 * @category Comms
 * @example
 * ```ts
 * import { MicrosoftOutlookService } from "@decaf-ts/integrations/comms/outlook";
 *
 * const outlook = new MicrosoftOutlookService();
 * await outlook.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_MICROSOFT_OUTLOOK_TOKEN,
 * });
 * await outlook.sendMail({
 *   to: "team@example.com",
 *   subject: "Deployment finished",
 *   body: "Release 1.2.0 is live",
 * });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as MicrosoftOutlookService
 *   participant Graph as Microsoft Graph
 *   Caller->>Service: sendMail(input)
 *   activate Service
 *   Service->>Service: requireAccessToken()
 *   Service->>Graph: POST /me/sendMail
 *   activate Graph
 *   Graph-->>Service: 202 Accepted
 *   deactivate Graph
 *   Service-->>Caller: { sent, to, subject }
 *   deactivate Service
 * @memberOf module:integrations/comms/outlook/service
 */
export class MicrosoftOutlookService extends HttpApiService<OutlookServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Microsoft Outlook";

  /**
   * @description The Microsoft Graph base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://graph.microsoft.com/v1.0"`.
   */
  protected defaultBaseUrl(): string {
    return "https://graph.microsoft.com/v1.0";
  }

  /**
   * @description Builds the Microsoft Graph bearer authorization headers
   * @summary Returns `Authorization: Bearer <token>` when configured, and no
   * headers otherwise.
   * @param {OutlookServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(
    config: OutlookServiceConfig
  ): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Outlook credentials and defaults from the environment
   * @summary Reads the `comms.outlook` slice and returns a partial config when
   * an access token is configured, `undefined` otherwise. Values pass through
   * `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<OutlookServiceConfig> | undefined} A partial config, or `undefined` when no Outlook token is configured.
   */
  protected configFromEnvironment():
    | Partial<OutlookServiceConfig>
    | undefined {
    const env = CommsEnvironment.comms.outlook;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts that a Microsoft Graph access token is configured
   * @summary Delegates to the shared `requireToken()` guard used by every
   * operation.
   * @returns {void}
   * @throws {InternalError} When the resolved config has no `token`.
   */
  protected requireAccessToken(): void {
    this.requireToken();
  }

  /**
   * @description Sends a mail message through Outlook
   * @summary `POST`s the message to `/me/sendMail`; recipients are normalized
   * to Graph envelopes and `saveToSentItems` defaults to `true`.
   * @param {OutlookMailInput} input - The recipients, subject, body, and content options.
   * @returns {Promise<unknown>} `{ sent: true, to, subject }` on success.
   * @throws {InternalError} When no token is configured, or recipients or subject are missing.
   * @throws {BadRequestError} When Graph rejects the request.
   * @example
   * ```ts
   * await outlook.sendMail({
   *   to: ["a@example.com", "b@example.com"],
   *   subject: "Status",
   *   body: "All systems operational",
   *   contentType: "Text",
   * });
   * ```
   */
  async sendMail(input: OutlookMailInput): Promise<unknown> {
    this.requireAccessToken();
    if (!input.to || !input.subject) {
      throw new InternalError(
        "Microsoft Outlook sendMail requires recipients and a subject"
      );
    }
    try {
      await this.client.post("/me/sendMail", {
        message: {
          subject: input.subject,
          body: {
            contentType: input.contentType ?? "Text",
            content: input.body ?? "",
          },
          toRecipients: recipientList(input.to),
          ...(input.cc ? { ccRecipients: recipientList(input.cc) } : {}),
          ...(input.bcc ? { bccRecipients: recipientList(input.bcc) } : {}),
        },
        saveToSentItems: input.saveToSentItems ?? true,
      });
      return { sent: true, to: input.to, subject: input.subject };
    } catch (error) {
      throw httpError("Microsoft Outlook", "send mail", error);
    }
  }

  /**
   * @description Lists messages in an Outlook mail folder
   * @summary `GET`s `/me/mailFolders/<folder>/messages` (default `inbox`)
   * applying the optional `$top`, `$filter`, and `$search` parameters.
   * @param {OutlookListInput} [input] - The folder and OData query options.
   * @returns {Promise<unknown>} The Graph message collection.
   * @throws {InternalError} When no token is configured.
   * @throws {NotFoundError} When the folder does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the query.
   */
  async listMessages(input: OutlookListInput = {}): Promise<unknown> {
    this.requireAccessToken();
    const folder = input.folderId ?? "inbox";
    try {
      const response = await this.client.get(
        `/me/mailFolders/${encodeURIComponent(folder)}/messages`,
        {
          params: {
            ...(input.top !== undefined ? { $top: input.top } : {}),
            ...(input.filter ? { $filter: input.filter } : {}),
            ...(input.search ? { $search: input.search } : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Outlook", "list messages", error);
    }
  }

  /**
   * @description Fetches a single Outlook message
   * @summary `GET`s `/me/messages/<id>` and returns the message payload.
   * @param {string} messageId - The Graph message ID.
   * @returns {Promise<unknown>} The message payload.
   * @throws {InternalError} When no token is configured or the message ID is empty.
   * @throws {NotFoundError} When the message does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async getMessage(messageId: string): Promise<unknown> {
    this.requireAccessToken();
    if (!messageId) {
      throw new InternalError("Microsoft Outlook requires a message id");
    }
    try {
      const response = await this.client.get(
        `/me/messages/${encodeURIComponent(messageId)}`
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Outlook", "get message", error);
    }
  }

  /**
   * @description Lists Outlook calendar events
   * @summary `GET`s `/me/events` applying the optional `$top`, `$filter`, and
   * `$search` parameters; the mail `folderId` is not used.
   * @param {OutlookListInput} [input] - The OData query options.
   * @returns {Promise<unknown>} The Graph event collection.
   * @throws {InternalError} When no token is configured.
   * @throws {BadRequestError} When Graph rejects the query.
   */
  async listEvents(input: OutlookListInput = {}): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get("/me/events", {
        params: {
          ...(input.top !== undefined ? { $top: input.top } : {}),
          ...(input.filter ? { $filter: input.filter } : {}),
          ...(input.search ? { $search: input.search } : {}),
        },
      });
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Outlook", "list events", error);
    }
  }

  /**
   * @description Creates an Outlook calendar event
   * @summary `POST`s the event to `/me/events`; `start`/`end` are sent with the
   * configured or default (`UTC`) time zone and attendees as required.
   * @param {OutlookEventInput} input - The event definition.
   * @returns {Promise<unknown>} The created Graph event.
   * @throws {InternalError} When no token is configured, or subject, start, or end is missing.
   * @throws {BadRequestError} When Graph rejects the event.
   * @example
   * ```ts
   * await outlook.createEvent({
   *   subject: "Release review",
   *   start: "2026-11-01T09:00:00",
   *   end: "2026-11-01T10:00:00",
   *   timeZone: "Europe/Lisbon",
   * });
   * ```
   */
  async createEvent(input: OutlookEventInput): Promise<unknown> {
    this.requireAccessToken();
    if (!input.subject || !input.start || !input.end) {
      throw new InternalError(
        "Microsoft Outlook createEvent requires subject, start, and end"
      );
    }
    const timeZone = input.timeZone ?? "UTC";
    try {
      const response = await this.client.post("/me/events", {
        subject: input.subject,
        ...(input.body
          ? { body: { contentType: "Text", content: input.body } }
          : {}),
        start: { dateTime: input.start, timeZone },
        end: { dateTime: input.end, timeZone },
        ...(input.location ? { location: { displayName: input.location } } : {}),
        ...(input.attendees
          ? {
              attendees: recipientList(input.attendees).map((entry) => ({
                emailAddress: entry.emailAddress,
                type: "required",
              })),
            }
          : {}),
      });
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Outlook", "create event", error);
    }
  }

  /**
   * @description Deletes an Outlook calendar event
   * @summary `DELETE`s `/me/events/<id>` and returns `{ deleted: true, eventId }`.
   * @param {string} eventId - The Graph event ID.
   * @returns {Promise<unknown>} `{ deleted: true, eventId }` on success.
   * @throws {InternalError} When no token is configured or the event ID is empty.
   * @throws {NotFoundError} When the event does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async deleteEvent(eventId: string): Promise<unknown> {
    this.requireAccessToken();
    if (!eventId) {
      throw new InternalError("Microsoft Outlook requires an event id");
    }
    try {
      await this.client.delete(`/me/events/${encodeURIComponent(eventId)}`);
      return { deleted: true, eventId };
    } catch (error) {
      throw httpError("Microsoft Outlook", "delete event", error);
    }
  }
}
