/**
 * @module integrations/comms/slack/service
 * @summary Slack Web API integration service for posting messages and reading conversations and users.
 * @description Exposes the Slack Web API (`chat.postMessage`, `conversations.*`, `users.info`)
 * as a decaf `@service("slack")` client-based service built on {@link HttpApiService}.
 * Configuration comes from an explicit `SlackServiceConfig` or the `comms.slack`
 * environment slice; every response is normalized and failures are mapped to decaf
 * errors via {@link httpError}.
 */
import { service } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { CommsEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the Slack service
 * @summary Extends {@link HttpApiServiceConfig} with the Slack Bot User OAuth
 * token used as a bearer token. When omitted, the `comms.slack` environment
 * slice supplies the token (and optional `baseUrl`/`timeout`).
 * @category Comms
 * @memberOf module:integrations/comms/slack/service
 */
export interface SlackServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Slack Bot User OAuth token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
}

/**
 * @description Input for posting a message to a Slack channel or thread
 * @summary Carries the destination `channel` (ID or `#channel`/`@user` style
 * name), the plain-text fallback `text`, optional Block Kit `blocks`, and the
 * posting options (thread reply, broadcast reply, unfurling).
 * @category Comms
 * @memberOf module:integrations/comms/slack/service
 */
export interface SlackPostMessageInput {
  /**
   * @description Destination channel ID, `#channel`, or `@user` mention
   */
  channel: string;
  /**
   * @description Plain-text message body (also the fallback for `blocks`)
   */
  text: string;
  /**
   * @description Optional Block Kit layout blocks replacing plain text
   */
  blocks?: unknown[];
  /**
   * @description Message timestamp to reply in-thread to
   */
  threadTs?: string;
  /**
   * @description Whether to also notify the channel when replying in a thread
   */
  replyBroadcast?: boolean;
  /**
   * @description Whether link previews are enabled
   */
  unfurlLinks?: boolean;
  /**
   * @description Whether media unfurls are enabled
   */
  unfurlMedia?: boolean;
}

/**
 * @description Result of a posted Slack message
 * @summary Echoes the destination `channel` and the message timestamp `ts`
 * (usable as `threadTs` for follow-up replies), with the posted `text` and the
 * raw `message` payload when Slack returns them.
 * @category Comms
 * @memberOf module:integrations/comms/slack/service
 */
export interface SlackPostMessageResult {
  channel: string;
  ts: string;
  text?: string;
  message?: unknown;
}

/**
 * @description Normalized Slack conversation (channel) descriptor
 * @summary Maps the raw `conversations.*` payload onto camelCase fields:
 * identity (`id`, `name`), visibility (`isPrivate`, `isArchived`),
 * `memberCount`, and topic/purpose summaries.
 * @category Comms
 * @memberOf module:integrations/comms/slack/service
 */
export interface SlackChannel {
  id: string;
  name?: string;
  isPrivate?: boolean;
  isArchived?: boolean;
  memberCount?: number;
  topic?: string;
  purpose?: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

/**
 * @description Slack Web API integration service
 * @summary A decaf `@service("slack")` HTTP service for posting messages,
 * listing conversations with cursor paging, fetching a single conversation,
 * and looking up users. The Slack Bot token is sent as a bearer token, every
 * call requires it (`requireToken()`), non-`ok` Slack responses raise
 * `InternalError`, and transport failures are mapped to decaf errors via
 * {@link httpError}.
 * @class SlackService
 * @category Comms
 * @example
 * ```ts
 * import { SlackService } from "@decaf-ts/integrations/comms/slack";
 *
 * const slack = new SlackService();
 * await slack.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_SLACK_TOKEN,
 * });
 * await slack.postMessage({
 *   channel: "#general",
 *   text: "Deployment finished",
 * });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as SlackService
 *   participant Slack as Slack Web API
 *   Caller->>Service: postMessage(input)
 *   activate Service
 *   Service->>Service: requireToken()
 *   Service->>Slack: POST /chat.postMessage
 *   activate Slack
 *   Slack-->>Service: { ok, channel, ts }
 *   deactivate Slack
 *   alt ok
 *     Service-->>Caller: SlackPostMessageResult
 *   else error
 *     Service--xCaller: InternalError / mapped decaf error
 *   end
 *   deactivate Service
 * @memberOf module:integrations/comms/slack/service
 */
@service("slack")
export class SlackService extends HttpApiService<SlackServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Slack";

  /**
   * @description The Slack Web API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://slack.com/api"`.
   */
  protected defaultBaseUrl(): string {
    return "https://slack.com/api";
  }

  /**
   * @description Builds the Slack bearer authorization headers
   * @summary Returns the `Authorization: Bearer <token>` header when the
   * config carries a token, and no headers otherwise.
   * @param {SlackServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: SlackServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Slack credentials and defaults from the environment
   * @summary Reads the `comms.slack` environment slice and returns a partial
   * config when a token is configured, `undefined` otherwise. Values pass
   * through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<SlackServiceConfig> | undefined} A partial config, or `undefined` when no Slack token is configured.
   */
  protected configFromEnvironment(): Partial<SlackServiceConfig> | undefined {
    const env = CommsEnvironment.comms.slack;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Posts a request to a Slack Web API method
   * @summary Shared request path for all Slack operations: asserts a token is
   * configured, `POST`s the payload to `/<method>`, rejects non-`ok` Slack
   * responses with an `InternalError`, and maps transport failures through
   * {@link httpError}.
   * @template T - The expected Slack response shape, extending `SlackApiResponse`.
   * @param {string} method - The Slack Web API method name (e.g. `"chat.postMessage"`).
   * @param {Record<string, unknown>} payload - The JSON body for the method.
   * @returns {Promise<T>} The parsed Slack response payload.
   * @throws {InternalError} When no token is configured or Slack answers with `ok: false`.
   * @throws {NotFoundError} When Slack answers with HTTP 404.
   * @throws {ConflictError} When Slack answers with HTTP 409.
   * @throws {BadRequestError} When Slack answers with any other HTTP error status.
   */
  protected async call<T extends SlackApiResponse>(
    method: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    this.requireToken();
    try {
      const response = await this.client.post<T>(`/${method}`, payload);
      const data = response.data;
      if (!data || data.ok !== true) {
        throw new InternalError(
          `Slack API ${method} failed: ${data?.error ?? "unknown error"}`
        );
      }
      return data;
    } catch (error) {
      throw httpError("Slack", `API ${method}`, error);
    }
  }

  /**
   * @description Posts a message to a Slack channel or thread
   * @summary Sends the input to Slack's `chat.postMessage` method and returns
   * the destination channel and message timestamp; use the returned `ts` as
   * `threadTs` to reply in the same thread. Provide `blocks` for Block Kit
   * layouts (with `text` as the fallback), or plain text alone.
   * @param {SlackPostMessageInput} input - The message destination and content.
   * @returns {Promise<SlackPostMessageResult>} The posted message's channel, timestamp, text, and raw payload.
   * @throws {InternalError} When no token is configured or Slack rejects the message.
   * @throws {NotFoundError} When the channel cannot be found (HTTP 404).
   * @throws {ConflictError} When Slack answers with HTTP 409.
   * @throws {BadRequestError} When Slack answers with any other HTTP error status.
   * @example
   * ```ts
   * await slack.postMessage({
   *   channel: "#deploys",
   *   text: "Release 1.2.0 is live",
   *   unfurlLinks: false,
   * });
   * ```
   */
  async postMessage(
    input: SlackPostMessageInput
  ): Promise<SlackPostMessageResult> {
    const data = await this.call<SlackApiResponse & SlackPostMessageResult>(
      "chat.postMessage",
      {
        channel: input.channel,
        text: input.text,
        blocks: input.blocks,
        thread_ts: input.threadTs,
        reply_broadcast: input.replyBroadcast,
        unfurl_links: input.unfurlLinks,
        unfurl_media: input.unfurlMedia,
      }
    );
    return {
      channel: data.channel,
      ts: data.ts,
      text: data.text,
      message: data.message,
    };
  }

  /**
   * @description Lists Slack conversations with cursor paging
   * @summary Calls `conversations.list` with a page size (default `100`),
   * conversation `types` (default public and private channels), and archived
   * exclusion (default `true`), returning normalized channels and the
   * `nextCursor` to pass back as `cursor` for the next page.
   * @param {object} [options] - Paging and filter options.
   * @param {number} [options.limit] - Page size; defaults to `100`.
   * @param {string} [options.cursor] - The `nextCursor` from the previous page.
   * @param {string} [options.types] - Comma-separated conversation types (e.g. `"public_channel,private_channel"`); defaults to `"public_channel,private_channel"`.
   * @param {boolean} [options.excludeArchived] - Whether archived channels are excluded; defaults to `true`.
   * @returns {Promise<{channels: SlackChannel[], nextCursor?: string}>} The page of channels and the cursor for the next page, when more pages exist.
   * @throws {InternalError} When no token is configured or Slack rejects the call.
   * @throws {NotFoundError} When Slack answers with HTTP 404.
   * @throws {ConflictError} When Slack answers with HTTP 409.
   * @throws {BadRequestError} When Slack answers with any other HTTP error status.
   * @example
   * ```ts
   * let cursor: string | undefined;
   * do {
   *   const page = await slack.listConversations({ limit: 200, cursor });
   *   console.log(page.channels.map((channel) => channel.name));
   *   cursor = page.nextCursor;
   * } while (cursor);
   * ```
   */
  async listConversations(
    options: {
      limit?: number;
      cursor?: string;
      types?: string;
      excludeArchived?: boolean;
    } = {}
  ): Promise<{
    channels: SlackChannel[];
    nextCursor?: string;
  }> {
    const data = await this.call<
      SlackApiResponse & {
        channels?: Array<Record<string, unknown>>;
        response_metadata?: { next_cursor?: string };
      }
    >("conversations.list", {
      limit: options.limit ?? 100,
      cursor: options.cursor,
      types: options.types ?? "public_channel,private_channel",
      exclude_archived: options.excludeArchived ?? true,
    });
    return {
      channels: (data.channels ?? []).map((channel) => ({
        id: String(channel["id"] ?? ""),
        name: envString(channel["name"]),
        isPrivate: channel["is_private"] === true,
        isArchived: channel["is_archived"] === true,
        memberCount:
          typeof channel["num_members"] === "number"
            ? (channel["num_members"] as number)
            : undefined,
        topic: (channel["topic"] as { value?: string } | undefined)?.value,
        purpose: (channel["purpose"] as { value?: string } | undefined)?.value,
      })),
      nextCursor: envString(data.response_metadata?.next_cursor),
    };
  }

  /**
   * @description Fetches a single Slack conversation
   * @summary Calls `conversations.info` for the given channel ID (or
   * `#name`) and returns the normalized channel descriptor.
   * @param {string} channel - The channel ID or `#name` to look up.
   * @returns {Promise<SlackChannel>} The normalized conversation descriptor.
   * @throws {InternalError} When no token is configured or Slack rejects the call.
   * @throws {NotFoundError} When the channel does not exist (HTTP 404).
   * @throws {ConflictError} When Slack answers with HTTP 409.
   * @throws {BadRequestError} When Slack answers with any other HTTP error status.
   */
  async getConversation(channel: string): Promise<SlackChannel> {
    const data = await this.call<
      SlackApiResponse & { channel?: Record<string, unknown> }
    >("conversations.info", { channel });
    const found = data.channel ?? {};
    return {
      id: String(found["id"] ?? channel),
      name: envString(found["name"]),
      isPrivate: found["is_private"] === true,
      isArchived: found["is_archived"] === true,
      memberCount:
        typeof found["num_members"] === "number"
          ? (found["num_members"] as number)
          : undefined,
      topic: (found["topic"] as { value?: string } | undefined)?.value,
      purpose: (found["purpose"] as { value?: string } | undefined)?.value,
    };
  }

  /**
   * @description Fetches a Slack user profile
   * @summary Calls `users.info` for the given user ID and returns the raw
   * user payload, or `undefined` when Slack reports no user.
   * @param {string} userId - The Slack user ID to look up (e.g. `"U12345678"`).
   * @returns {Promise<Record<string, unknown> | undefined>} The raw user payload, or `undefined` when the user is not found.
   * @throws {InternalError} When no token is configured or Slack rejects the call.
   * @throws {NotFoundError} When the user does not exist (HTTP 404).
   * @throws {ConflictError} When Slack answers with HTTP 409.
   * @throws {BadRequestError} When Slack answers with any other HTTP error status.
   */
  async getUser(
    userId: string
  ): Promise<Record<string, unknown> | undefined> {
    const data = await this.call<
      SlackApiResponse & { user?: Record<string, unknown> }
    >("users.info", { user: userId });
    return data.user;
  }
}
