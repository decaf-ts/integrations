/**
 * @module integrations/comms/telegram/service
 * @summary Telegram Bot API integration service for sending messages and reading updates.
 * @description Exposes the Telegram Bot API (`getMe`, `sendMessage`,
 * `getUpdates`, `sendChatAction`) as an undecorated client-based service built
 * on {@link HttpApiService}. The bot token is part of the request
 * path (`/bot<token>/<method>`); configuration comes from an explicit
 * `TelegramServiceConfig` or the `comms.telegram` environment slice, and
 * failures are mapped to decaf errors via {@link httpError}.
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
 * @description Configuration for the Telegram service
 * @summary Extends {@link HttpApiServiceConfig} with the Telegram bot token
 * used to build the `/bot<token>` request path. When omitted, the
 * `comms.telegram` environment slice supplies the token (and optional
 * `baseUrl`/`timeout`).
 * @category Comms
 * @memberOf module:integrations/comms/telegram/service
 */
export interface TelegramServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Telegram bot token
   * @summary Issued by BotFather; embedded in the request path for every call.
   */
  token?: string;
}

/**
 * @description Input for sending a Telegram message
 * @summary Carries the destination `chatId`, the message `text`, the optional
 * parse mode (`Markdown`, `MarkdownV2`, or `HTML`), and the notification,
 * preview, reply, and forum-thread options.
 * @category Comms
 * @memberOf module:integrations/comms/telegram/service
 */
export interface TelegramSendMessageInput {
  /**
   * @description Destination chat ID or `@channelusername`
   */
  chatId: string | number;
  /**
   * @description Message text (up to 4096 characters)
   */
  text: string;
  /**
   * @description Parse mode for entity recognition in `text`
   */
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  /**
   * @description Whether the message is sent silently
   */
  disableNotification?: boolean;
  /**
   * @description Whether link previews are disabled
   */
  disablePreview?: boolean;
  /**
   * @description Message to reply to
   */
  replyToMessageId?: number;
  /**
   * @description Forum thread to post into
   */
  messageThreadId?: number;
}

/**
 * @description Normalized Telegram message descriptor
 * @summary The relevant subset of the Telegram `Message` object: identifiers
 * (`message_id`, `date`), the sending `chat`, and the message `text`.
 * @category Comms
 * @memberOf module:integrations/comms/telegram/service
 */
export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type?: string; title?: string; username?: string };
  text?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * @description Telegram Bot API integration service
 * @summary An undecorated HTTP service for verifying the bot
 * identity, sending messages with parse modes and reply/thread options, long
 * or short polling `getUpdates`, and posting chat actions. The bot token is
 * required (`requireToken()`) and embedded in the request path; non-`ok` Bot
 * API responses raise `InternalError`, and transport failures are mapped to
 * decaf errors via {@link httpError}.
 * @class TelegramService
 * @category Comms
 * @example
 * ```ts
 * import { TelegramService } from "@decaf-ts/integrations/comms/telegram";
 *
 * const telegram = new TelegramService();
 * await telegram.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_TELEGRAM_TOKEN,
 * });
 * await telegram.sendMessage({
 *   chatId: "@mychannel",
 *   text: "Release 1.2.0 is live",
 *   parseMode: "HTML",
 * });
 * ```
 * @memberOf module:integrations/comms/telegram/service
 */
export class TelegramService extends HttpApiService<TelegramServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Telegram";

  /**
   * @description The Telegram Bot API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://api.telegram.org"`.
   */
  protected defaultBaseUrl(): string {
    return "https://api.telegram.org";
  }

  /**
   * @description Reads the Telegram credentials and defaults from the environment
   * @summary Reads the `comms.telegram` environment slice and returns a
   * partial config when a token is configured, `undefined` otherwise. Values
   * pass through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<TelegramServiceConfig> | undefined} A partial config, or `undefined` when no Telegram token is configured.
   */
  protected configFromEnvironment(): Partial<TelegramServiceConfig> | undefined {
    const env = CommsEnvironment.comms.telegram;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Calls a Telegram Bot API method with the configured bot token
   * @summary Shared request path for all Telegram operations: resolves the
   * token (`requireToken()`), `POST`s the payload to
   * `/bot<token>/<method>`, rejects non-`ok` Bot API responses with an
   * `InternalError`, and maps transport failures through {@link httpError}.
   * @template T - The expected `result` payload type of the Bot API response.
   * @param {string} method - The Bot API method name (e.g. `"sendMessage"`).
   * @param {Record<string, unknown>} [payload] - The JSON body for the method; defaults to an empty object.
   * @returns {Promise<T>} The `result` payload of the Bot API response.
   * @throws {InternalError} When no token is configured or the Bot API answers with `ok: false`.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When the endpoint answers with HTTP 409.
   * @throws {BadRequestError} When the endpoint answers with any other HTTP error status.
   */
  protected async call<T>(
    method: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const token = this.requireToken();
    try {
      const response = await this.client.post<TelegramApiResponse<T>>(
        `/bot${token}/${method}`,
        payload
      );
      const data = response.data;
      if (!data || data.ok !== true) {
        throw new InternalError(
          `Telegram Bot API ${method} failed: ${
            data?.description ?? "unknown error"
          }`
        );
      }
      return data.result as T;
    } catch (error) {
      throw httpError("Telegram", `Bot API ${method}`, error);
    }
  }

  /**
   * @description Fetches the authenticated bot's identity
   * @summary Calls the `getMe` method and returns the raw bot descriptor
   * (including `id`, `username`, and `can_join_groups` flags).
   * @returns {Promise<Record<string, unknown>>} The raw `User` payload describing the bot.
   * @throws {InternalError} When no token is configured or the Bot API rejects the call.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When the endpoint answers with HTTP 409.
   * @throws {BadRequestError} When the endpoint answers with any other HTTP error status.
   */
  async getMe(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("getMe");
  }

  /**
   * @description Sends a message to a Telegram chat
   * @summary Calls the `sendMessage` method with the destination chat, text,
   * and the requested parse/notification/reply/thread options, returning the
   * sent message descriptor.
   * @param {TelegramSendMessageInput} input - The message destination, content, and options.
   * @returns {Promise<TelegramMessage>} The sent message descriptor.
   * @throws {InternalError} When no token is configured or the Bot API rejects the message.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When the endpoint answers with HTTP 409.
   * @throws {BadRequestError} When the endpoint answers with any other HTTP error status.
   * @example
   * ```ts
   * await telegram.sendMessage({
   *   chatId: "-1001234567890",
   *   text: "*Release* 1.2.0 is live",
   *   parseMode: "MarkdownV2",
   *   disableNotification: true,
   * });
   * ```
   */
  async sendMessage(
    input: TelegramSendMessageInput
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: input.parseMode,
      disable_notification: input.disableNotification,
      disable_web_page_preview: input.disablePreview,
      reply_to_message_id: input.replyToMessageId,
      message_thread_id: input.messageThreadId,
    });
  }

  /**
   * @description Polls pending bot updates
   * @summary Calls the `getUpdates` method, optionally with an `offset`
   * (confirmation of processed updates), a `limit` on returned updates, and a
   * long-polling `timeoutSeconds`. Advance `offset` past each handled
   * update's `update_id` to avoid re-reading them.
   * @param {object} [options] - Polling options.
   * @param {number} [options.offset] - The first update ID to return (previous ID + 1).
   * @param {number} [options.limit] - Maximum number of updates to return (1-100).
   * @param {number} [options.timeoutSeconds] - Long-polling timeout in seconds.
   * @returns {Promise<Array<Record<string, unknown>>>} The raw `Update` payloads.
   * @throws {InternalError} When no token is configured or the Bot API rejects the call.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When the endpoint answers with HTTP 409 (e.g. another `getUpdates` call is in flight).
   * @throws {BadRequestError} When the endpoint answers with any other HTTP error status.
   */
  async getUpdates(
    options: { offset?: number; limit?: number; timeoutSeconds?: number } = {}
  ): Promise<Array<Record<string, unknown>>> {
    return this.call<Array<Record<string, unknown>>>("getUpdates", {
      offset: options.offset,
      limit: options.limit,
      timeout: options.timeoutSeconds,
    });
  }

  /**
   * @description Posts a chat action (typing indicator)
   * @summary Calls the `sendChatAction` method so clients display the given
   * action (e.g. `"typing"`) for up to five seconds.
   * @param {string | number} chatId - The destination chat ID or `@channelusername`.
   * @param {string} [action] - The action to display; defaults to `"typing"`.
   * @returns {Promise<boolean>} Whether the action was accepted.
   * @throws {InternalError} When no token is configured or the Bot API rejects the call.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When the endpoint answers with HTTP 409.
   * @throws {BadRequestError} When the endpoint answers with any other HTTP error status.
   */
  async sendChatAction(
    chatId: string | number,
    action = "typing"
  ): Promise<boolean> {
    return this.call<boolean>("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }
}
