/**
 * @module integrations/comms/discord/service
 * @summary Discord Bot API integration service for messages, channels, and reactions.
 * @description Exposes the Discord Bot REST API (v10) as an undecorated
 * client-based service built on {@link HttpApiService}. Configuration comes
 * from an explicit `DiscordServiceConfig` or the `comms.discord` environment
 * slice, and the bot token is sent as `Authorization: Bot <token>` on every
 * call. Credentials are referenced from configuration (and, from as-graph
 * nodes, from the resolved `discord` credential secret) and are never embedded
 * in source. Failures are mapped to decaf errors via {@link httpError}.
 *
 * `core.comms.discord` is a callable messaging service/node. It is distinct
 * from the mastra agent channel kinds `core.agent.trigger.discord` and
 * `core.agent.response.discord`, which receive inbound conversations and post
 * agent replies through host-supplied channel adapters.
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
 * @description Configuration for the Discord service
 * @summary Extends {@link HttpApiServiceConfig} with the Discord bot token
 * sent as `Authorization: Bot <token>`. When omitted, the `comms.discord`
 * environment slice supplies `token` (plus optional `baseUrl`/`timeout`).
 * The token is a credential reference read from configuration, never a value
 * to hard-code in source.
 * @category Comms
 * @memberOf module:integrations/comms/discord/service
 */
export interface DiscordServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Discord bot token
   * @summary Sent as `Authorization: Bot <token>` with every API call.
   */
  token?: string;
}

/**
 * @description Input for sending a Discord channel message
 * @summary Carries the destination `channelId`, the message `content`, the
 * optional text-to-speech flag, and optional rich `embeds`.
 * @category Comms
 * @memberOf module:integrations/comms/discord/service
 */
export interface DiscordMessageInput {
  /**
   * @description ID of the channel that receives the message
   */
  channelId: string;
  /**
   * @description Plain-text message body
   */
  content: string;
  /**
   * @description Whether Discord reads the message with text-to-speech
   */
  tts?: boolean;
  /**
   * @description Rich embed payloads attached to the message
   */
  embeds?: unknown[];
}

/**
 * @description Input for listing a Discord channel's messages
 * @summary Carries the `channelId` plus optional page size and a `before`
 * message ID cursor for fetching older messages.
 * @category Comms
 * @memberOf module:integrations/comms/discord/service
 */
export interface DiscordMessageListInput {
  /**
   * @description ID of the channel to list messages from
   */
  channelId: string;
  /**
   * @description Maximum number of messages to return
   */
  limit?: number;
  /**
   * @description Message ID cursor; only older messages are returned
   */
  before?: string;
}

/**
 * @description Input for creating a Discord guild channel
 * @summary Carries the target `guildId`, the new channel `name`, and the
 * optional channel `type` (Discord numeric type, default `0` for text),
 * `topic`, and `parentId` (category).
 * @category Comms
 * @memberOf module:integrations/comms/discord/service
 */
export interface DiscordChannelInput {
  /**
   * @description ID of the guild that owns the new channel
   */
  guildId: string;
  /**
   * @description Name of the new channel
   */
  name: string;
  /**
   * @description Discord numeric channel type (default `0`, text channel)
   */
  type?: number;
  /**
   * @description Optional channel topic
   */
  topic?: string;
  /**
   * @description Optional parent category ID
   */
  parentId?: string;
}

/**
 * @description Input for adding a reaction to a Discord message
 * @summary Identifies the `channelId`, the target `messageId`, and the
 * `emoji` to add as the bot user.
 * @category Comms
 * @memberOf module:integrations/comms/discord/service
 */
export interface DiscordReactionInput {
  /**
   * @description ID of the channel containing the message
   */
  channelId: string;
  /**
   * @description ID of the message to react to
   */
  messageId: string;
  /**
   * @description Emoji to add (Unicode character or `name:id` custom emoji)
   */
  emoji: string;
}

const DEFAULT_CHANNEL_TYPE = 0;

/**
 * @description Discord Bot API integration service
 * @summary An undecorated HTTP service for channel messages
 * (`sendMessage`, `getMessage`, `listMessages`), channels (`getChannel`,
 * `listChannels`, `createChannel`, `deleteChannel`), and reactions
 * (`addReaction`). Every operation requires a bot token and throws
 * `InternalError` when it is missing or a required identifier is empty;
 * transport failures are mapped to decaf errors via {@link httpError}. This is
 * the callable comms surface (`core.comms.discord`), not the mastra agent
 * trigger/response kinds.
 * @class DiscordService
 * @extends HttpApiService
 * @category Comms
 * @example
 * ```ts
 * import { DiscordService } from "@decaf-ts/integrations/comms/discord";
 *
 * const discord = new DiscordService();
 * await discord.initialize({ token: process.env.GRAPH_CREDENTIAL_DISCORD_TOKEN });
 * await discord.sendMessage({
 *   channelId: process.env.DISCORD_CHANNEL_ID ?? "",
 *   content: "Deployment finished",
 * });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as DiscordService
 *   participant Discord as Discord Bot API
 *   Caller->>Service: sendMessage(input)
 *   activate Service
 *   Service->>Service: requireBotToken()
 *   Service->>Discord: POST /channels/{id}/messages
 *   activate Discord
 *   Discord-->>Service: message payload
 *   deactivate Discord
 *   Service-->>Caller: message payload
 *   deactivate Service
 * @memberOf module:integrations/comms/discord/service
 */
export class DiscordService extends HttpApiService<DiscordServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Discord";

  /**
   * @description The Discord Bot API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://discord.com/api/v10"`.
   */
  protected defaultBaseUrl(): string {
    return "https://discord.com/api/v10";
  }

  /**
   * @description Builds the Discord bot authorization header
   * @summary Returns `Authorization: Bot <token>` when the config carries a
   * token, and no headers otherwise.
   * @param {DiscordServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: DiscordServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bot ${config.token}` } : {};
  }

  /**
   * @description Reads the Discord credentials and defaults from the environment
   * @summary Reads the `comms.discord` environment slice and returns a partial
   * config when a bot token is configured, `undefined` otherwise. Values pass
   * through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<DiscordServiceConfig> | undefined} A partial config, or `undefined` when no Discord token is configured.
   */
  protected configFromEnvironment(): Partial<DiscordServiceConfig> | undefined {
    const env = CommsEnvironment.comms.discord;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts that a Discord bot token is configured
   * @summary Called by every operation before it touches the network.
   * @returns {void}
   * @throws {InternalError} When the resolved config has no `token`.
   */
  protected requireBotToken(): void {
    if (!this.config.token) {
      throw new InternalError("Discord requires a bot token");
    }
  }

  /**
   * @description Builds the encoded path for a channel resource
   * @summary Validates the channel ID and URL-encodes it into `/channels/<id>`.
   * @param {string} channelId - The Discord channel ID.
   * @returns {string} The channel API path.
   * @throws {InternalError} When `channelId` is empty.
   */
  private channelPath(channelId: string): string {
    if (!channelId) {
      throw new InternalError("Discord requires a channel id");
    }
    return `/channels/${encodeURIComponent(channelId)}`;
  }

  /**
   * @description Sends a message to a Discord channel
   * @summary `POST`s the content (and optional `tts`/`embeds`) to the channel
   * messages endpoint and returns Discord's message payload.
   * @param {DiscordMessageInput} input - The destination channel and message content.
   * @returns {Promise<unknown>} The created message payload.
   * @throws {InternalError} When no bot token is configured.
   * @throws {BadRequestError} When Discord rejects the request.
   * @example
   * ```ts
   * await discord.sendMessage({ channelId: "1234567890", content: "Hello" });
   * ```
   */
  async sendMessage(input: DiscordMessageInput): Promise<unknown> {
    this.requireBotToken();
    try {
      const response = await this.client.post(
        `${this.channelPath(input.channelId)}/messages`,
        {
          content: input.content,
          tts: input.tts ?? false,
          ...(input.embeds ? { embeds: input.embeds } : {}),
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Discord", "send message", error);
    }
  }

  /**
   * @description Fetches a single Discord message
   * @summary `GET`s the message by channel and message ID and returns the
   * message payload.
   * @param {string} channelId - The channel containing the message.
   * @param {string} messageId - The message ID to fetch.
   * @returns {Promise<unknown>} The message payload.
   * @throws {InternalError} When no bot token is configured or the message ID is empty.
   * @throws {NotFoundError} When the message does not exist (HTTP 404).
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async getMessage(channelId: string, messageId: string): Promise<unknown> {
    this.requireBotToken();
    if (!messageId) {
      throw new InternalError("Discord requires a message id");
    }
    try {
      const response = await this.client.get(
        `${this.channelPath(channelId)}/messages/${encodeURIComponent(
          messageId
        )}`
      );
      return response.data;
    } catch (error) {
      throw httpError("Discord", "get message", error);
    }
  }

  /**
   * @description Lists messages in a Discord channel
   * @summary `GET`s the channel messages with the optional `limit` and
   * `before` cursor and returns Discord's message page.
   * @param {DiscordMessageListInput} input - The channel and paging options.
   * @returns {Promise<unknown>} The message page payload.
   * @throws {InternalError} When no bot token is configured.
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async listMessages(input: DiscordMessageListInput): Promise<unknown> {
    this.requireBotToken();
    try {
      const response = await this.client.get(
        `${this.channelPath(input.channelId)}/messages`,
        {
          params: {
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
            ...(input.before ? { before: input.before } : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Discord", "list messages", error);
    }
  }

  /**
   * @description Fetches a Discord channel
   * @summary `GET`s the channel by ID and returns its payload.
   * @param {string} channelId - The channel ID to fetch.
   * @returns {Promise<unknown>} The channel payload.
   * @throws {InternalError} When no bot token is configured or the channel ID is empty.
   * @throws {NotFoundError} When the channel does not exist (HTTP 404).
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async getChannel(channelId: string): Promise<unknown> {
    this.requireBotToken();
    try {
      const response = await this.client.get(this.channelPath(channelId));
      return response.data;
    } catch (error) {
      throw httpError("Discord", "get channel", error);
    }
  }

  /**
   * @description Lists every channel in a Discord guild
   * @summary `GET`s `/guilds/<id>/channels` and returns the channel list.
   * @param {string} guildId - The guild whose channels are listed.
   * @returns {Promise<unknown>} The guild channel list payload.
   * @throws {InternalError} When no bot token is configured or the guild ID is empty.
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async listChannels(guildId: string): Promise<unknown> {
    this.requireBotToken();
    if (!guildId) {
      throw new InternalError("Discord requires a guild id");
    }
    try {
      const response = await this.client.get(
        `/guilds/${encodeURIComponent(guildId)}/channels`
      );
      return response.data;
    } catch (error) {
      throw httpError("Discord", "list channels", error);
    }
  }

  /**
   * @description Creates a channel in a Discord guild
   * @summary `POST`s the channel `name`, numeric `type` (default text), and
   * optional `topic`/`parentId` to the guild channels endpoint.
   * @param {DiscordChannelInput} input - The guild and new channel definition.
   * @returns {Promise<unknown>} The created channel payload.
   * @throws {InternalError} When no bot token is configured.
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async createChannel(input: DiscordChannelInput): Promise<unknown> {
    this.requireBotToken();
    try {
      const response = await this.client.post(
        `/guilds/${encodeURIComponent(input.guildId)}/channels`,
        {
          name: input.name,
          type: input.type ?? DEFAULT_CHANNEL_TYPE,
          ...(input.topic ? { topic: input.topic } : {}),
          ...(input.parentId ? { parent_id: input.parentId } : {}),
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Discord", "create channel", error);
    }
  }

  /**
   * @description Deletes a Discord channel
   * @summary `DELETE`s the channel and returns the response payload, falling
   * back to `{ deleted: true, channelId }` when Discord returns no body.
   * @param {string} channelId - The channel ID to delete.
   * @returns {Promise<unknown>} The deletion payload.
   * @throws {InternalError} When no bot token is configured or the channel ID is empty.
   * @throws {NotFoundError} When the channel does not exist (HTTP 404).
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async deleteChannel(channelId: string): Promise<unknown> {
    this.requireBotToken();
    try {
      const response = await this.client.delete(this.channelPath(channelId));
      return response.data ?? { deleted: true, channelId };
    } catch (error) {
      throw httpError("Discord", "delete channel", error);
    }
  }

  /**
   * @description Adds a reaction to a Discord message as the bot
   * @summary `PUT`s the emoji to the message's `@me` reaction endpoint and
   * echoes the channel and message IDs on success.
   * @param {DiscordReactionInput} input - The channel, message, and emoji.
   * @returns {Promise<unknown>} `{ channelId, messageId }` on success.
   * @throws {InternalError} When no bot token is configured, or the message ID or emoji is empty.
   * @throws {BadRequestError} When Discord rejects the request.
   */
  async addReaction(input: DiscordReactionInput): Promise<unknown> {
    this.requireBotToken();
    if (!input.messageId || !input.emoji) {
      throw new InternalError("Discord requires a message id and emoji");
    }
    try {
      await this.client.put(
        `${this.channelPath(input.channelId)}/messages/${encodeURIComponent(
          input.messageId
        )}/reactions/${encodeURIComponent(input.emoji)}/@me`
      );
      return { channelId: input.channelId, messageId: input.messageId };
    } catch (error) {
      throw httpError("Discord", "add reaction", error);
    }
  }
}
