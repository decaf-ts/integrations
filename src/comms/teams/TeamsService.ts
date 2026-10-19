/**
 * @module integrations/comms/teams/service
 * @summary Microsoft Teams integration service for webhook and Microsoft Graph channel messaging.
 * @description Exposes two delivery paths as a decaf `@service("teams")`
 * client-based service built on {@link HttpApiService}: incoming-webhook
 * `MessageCard` delivery (no Graph token required) and Microsoft Graph
 * channel messaging, team listing, and channel listing (requires a Graph
 * access token). Configuration comes from an explicit `TeamsServiceConfig`
 * or the `comms.teams` environment slice, and failures are mapped to decaf
 * errors via {@link httpError}.
 */
import { service } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import Axios from "axios";
import { CommsEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the Teams service
 * @summary Extends {@link HttpApiServiceConfig} with the Microsoft Graph
 * access token (required for channel messaging and listings, optional when
 * only webhooks are used) and the incoming-webhook URL. When omitted, the
 * `comms.teams` environment slice supplies both (and optional
 * `baseUrl`/`timeout`).
 * @category Comms
 * @memberOf module:integrations/comms/teams/service
 */
export interface TeamsServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Microsoft Graph access token
   * @summary Sent as `Authorization: Bearer <token>` for Graph requests.
   */
  token?: string;
  /**
   * @description Incoming webhook URL for `sendWebhook`
   * @summary Typically an Office 365 connector URL; required only for webhook delivery.
   */
  webhookUrl?: string;
}

/**
 * @description Input for Teams incoming-webhook delivery
 * @summary Carries the plain-text `text`, an optional card `title`, and
 * whether the text is rendered as markdown (default `true`). Delivered as an
 * Office 365 `MessageCard` to the configured webhook URL.
 * @category Comms
 * @memberOf module:integrations/comms/teams/service
 */
export interface TeamsWebhookMessage {
  /**
   * @description Message body text
   */
  text: string;
  /**
   * @description Optional card title
   */
  title?: string;
  /**
   * @description Whether `text` is rendered as markdown; defaults to `true`
   */
  markdown?: boolean;
}

/**
 * @description Input for sending a message into a Teams channel via Microsoft Graph
 * @summary Carries the target `teamId` and `channelId`, the message
 * `content`, and its content type (`text` by default, or `html`).
 * @category Comms
 * @memberOf module:integrations/comms/teams/service
 */
export interface TeamsChannelMessage {
  teamId: string;
  channelId: string;
  content: string;
  contentType?: "text" | "html";
}

/**
 * @description Microsoft Teams integration service
 * @summary A decaf `@service("teams")` HTTP service combining incoming-webhook
 * delivery (needs only `webhookUrl`) with Microsoft Graph operations — channel
 * messaging, team listing, and channel listing (need a Graph `token`).
 * Webhook delivery posts an Office 365 `MessageCard` directly to the
 * configured URL; Graph operations go through the service client with bearer
 * auth, require a token (`requireToken()`), and map transport failures to
 * decaf errors via {@link httpError}.
 * @class TeamsService
 * @category Comms
 * @example
 * ```ts
 * import { TeamsService } from "@decaf-ts/integrations/comms/teams";
 *
 * const teams = new TeamsService();
 * await teams.initialize({
 *   webhookUrl: process.env.GRAPH_CREDENTIAL_TEAMS_WEBHOOK_URL,
 *   token: process.env.GRAPH_CREDENTIAL_TEAMS_TOKEN,
 * });
 * await teams.sendWebhook({ title: "Deploy", text: "Release 1.2.0 is live" });
 * ```
 * @memberOf module:integrations/comms/teams/service
 */
@service("teams")
export class TeamsService extends HttpApiService<TeamsServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Microsoft Teams";

  /**
   * @description The Microsoft Graph v1.0 base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://graph.microsoft.com/v1.0"`.
   */
  protected defaultBaseUrl(): string {
    return "https://graph.microsoft.com/v1.0";
  }

  /**
   * @description Builds the Microsoft Graph bearer authorization headers
   * @summary Returns the `Authorization: Bearer <token>` header when the
   * config carries a token, and no headers otherwise.
   * @param {TeamsServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: TeamsServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Teams credentials and defaults from the environment
   * @summary Reads the `comms.teams` environment slice and returns a partial
   * config when a Graph token or webhook URL is configured, `undefined`
   * otherwise. Values pass through `envString`/`envNumber` to reject
   * unset-leaf proxies.
   * @returns {Partial<TeamsServiceConfig> | undefined} A partial config, or `undefined` when neither token nor webhook URL is configured.
   */
  protected configFromEnvironment(): Partial<TeamsServiceConfig> | undefined {
    const env = CommsEnvironment.comms.teams;
    const token = envString(env?.token);
    const webhookUrl = envString(env?.webhookUrl);
    if (!token && !webhookUrl) return undefined;
    return {
      token,
      webhookUrl,
      baseUrl: envString(env?.baseUrl),
      timeout: envNumber(env?.timeout),
    };
  }

  /**
   * @description Delivers a MessageCard through the configured incoming webhook
   * @summary Posts an Office 365 `MessageCard` (`@type: "MessageCard"`) with
   * the title, text, and markdown flag directly to `config.webhookUrl` using
   * a standalone Axios call (no Graph token involved). Requires a configured
   * webhook URL.
   * @param {TeamsWebhookMessage} input - The card title, text, and markdown flag.
   * @returns {Promise<unknown>} The raw webhook response payload.
   * @throws {InternalError} When no webhook URL is configured.
   * @throws {NotFoundError} When the webhook endpoint answers with HTTP 404.
   * @throws {ConflictError} When the webhook endpoint answers with HTTP 409.
   * @throws {BadRequestError} When the webhook endpoint answers with any other HTTP error status.
   */
  async sendWebhook(input: TeamsWebhookMessage): Promise<unknown> {
    const webhookUrl = this.config.webhookUrl;
    if (!webhookUrl) {
      throw new InternalError("Microsoft Teams requires a webhook URL");
    }
    try {
      const response = await Axios.post(
        webhookUrl,
        {
          "@type": "MessageCard",
          "@context": "https://schema.org/extensions",
          summary: input.title ?? input.text,
          title: input.title,
          text: input.text,
          markdown: input.markdown ?? true,
        },
        { timeout: this.config.timeout ?? 30000 }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Teams", "webhook delivery", error);
    }
  }

  /**
   * @description Sends a message into a Teams channel through Microsoft Graph
   * @summary `POST`s a chat message to
   * `/teams/<teamId>/channels/<channelId>/messages` with the given content
   * type (`text` by default, or `html`). Requires a Graph token and both a
   * team and channel ID; IDs are URL-encoded.
   * @param {TeamsChannelMessage} input - The target team/channel and the message content.
   * @returns {Promise<unknown>} The raw Graph message payload.
   * @throws {InternalError} When no token is configured or the team/channel IDs are missing.
   * @throws {NotFoundError} When the team or channel does not exist (HTTP 404).
   * @throws {ConflictError} When Graph answers with HTTP 409.
   * @throws {BadRequestError} When Graph answers with any other HTTP error status.
   * @example
   * ```ts
   * await teams.sendChannelMessage({
   *   teamId: "team-id",
   *   channelId: "channel-id",
   *   content: "<b>Release</b> 1.2.0 is live",
   *   contentType: "html",
   * });
   * ```
   */
  async sendChannelMessage(input: TeamsChannelMessage): Promise<unknown> {
    this.requireToken();
    if (!input.teamId || !input.channelId) {
      throw new InternalError(
        "Microsoft Teams channel messages require a team and channel"
      );
    }
    try {
      const response = await this.client.post(
        `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(
          input.channelId
        )}/messages`,
        {
          body: {
            contentType: input.contentType ?? "text",
            content: input.content,
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Teams", "channel message", error);
    }
  }

  /**
   * @description Lists Teams accessible to the authenticated identity
   * @summary `GET`s `/teams` with a `$top` page size (default `50`) and
   * returns the raw Graph `team` payloads.
   * @param {number} [limit] - Maximum number of teams to return; defaults to `50`.
   * @returns {Promise<Array<Record<string, unknown>>>} The raw Graph `team` payloads.
   * @throws {InternalError} When no token is configured.
   * @throws {NotFoundError} When Graph answers with HTTP 404.
   * @throws {ConflictError} When Graph answers with HTTP 409.
   * @throws {BadRequestError} When Graph answers with any other HTTP error status.
   */
  async listTeams(
    limit = 50
  ): Promise<Array<Record<string, unknown>>> {
    this.requireToken();
    try {
      const response = await this.client.get<{
        value?: Array<Record<string, unknown>>;
      }>("/teams", { params: { $top: limit } });
      return response.data.value ?? [];
    } catch (error) {
      throw httpError("Microsoft Teams", "list teams", error);
    }
  }

  /**
   * @description Lists channels of a Teams team
   * @summary `GET`s `/teams/<teamId>/channels` and returns the raw Graph
   * `channel` payloads; the team ID is URL-encoded.
   * @param {string} teamId - The ID of the team whose channels are listed.
   * @returns {Promise<Array<Record<string, unknown>>>} The raw Graph `channel` payloads.
   * @throws {InternalError} When no token is configured.
   * @throws {NotFoundError} When the team does not exist (HTTP 404).
   * @throws {ConflictError} When Graph answers with HTTP 409.
   * @throws {BadRequestError} When Graph answers with any other HTTP error status.
   */
  async listChannels(
    teamId: string
  ): Promise<Array<Record<string, unknown>>> {
    this.requireToken();
    try {
      const response = await this.client.get<{
        value?: Array<Record<string, unknown>>;
      }>(`/teams/${encodeURIComponent(teamId)}/channels`);
      return response.data.value ?? [];
    } catch (error) {
      throw httpError("Microsoft Teams", "list channels", error);
    }
  }
}
