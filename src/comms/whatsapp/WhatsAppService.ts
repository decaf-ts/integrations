/**
 * @module integrations/comms/whatsapp/service
 * @summary WhatsApp Cloud API integration service for text, template, and media messages.
 * @description Exposes the Meta WhatsApp Cloud API (Graph `v19.0`) as an
 * undecorated client-based service built on {@link HttpApiService}.
 * Configuration comes from an explicit `WhatsAppServiceConfig` or the
 * `comms.whatsApp` environment slice; the access token is sent as
 * `Authorization: Bearer <token>` and the sender is identified by the
 * configured `phoneNumberId`. Credentials are referenced from configuration
 * (and, from as-graph nodes, from the resolved `whatsapp` credential secret)
 * and are never embedded in source. Failures are mapped to decaf errors via
 * {@link httpError}.
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
 * @description Configuration for the WhatsApp service
 * @summary Extends {@link HttpApiServiceConfig} with the Meta access token
 * (sent as a bearer token) and the sender `phoneNumberId` used in the
 * `/messages` path. When omitted, the `comms.whatsApp` environment slice
 * supplies both (plus optional `baseUrl`/`timeout`). Both values are
 * credential references, never literals in source.
 * @category Comms
 * @memberOf module:integrations/comms/whatsapp/service
 */
export interface WhatsAppServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Meta WhatsApp Cloud API access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
  /**
   * @description Sender phone number ID used in the messages path
   */
  phoneNumberId?: string;
}

/**
 * @description Input for sending a WhatsApp text message
 * @summary Carries the recipient (`to`, E.164 digits without `+`), the text
 * body, and whether link previews are generated.
 * @category Comms
 * @memberOf module:integrations/comms/whatsapp/service
 */
export interface WhatsAppTextInput {
  /**
   * @description Recipient phone number in international format
   */
  to: string;
  /**
   * @description Text message body
   */
  text: string;
  /**
   * @description Whether WhatsApp generates a link preview
   */
  previewUrl?: boolean;
}

/**
 * @description Input for sending a WhatsApp template message
 * @summary Carries the recipient, the approved `templateName`, its
 * `languageCode`, and optional template `components`.
 * @category Comms
 * @memberOf module:integrations/comms/whatsapp/service
 */
export interface WhatsAppTemplateInput {
  /**
   * @description Recipient phone number in international format
   */
  to: string;
  /**
   * @description Name of the approved message template
   */
  templateName: string;
  /**
   * @description Template language code (e.g. `"en_US"`)
   */
  languageCode: string;
  /**
   * @description Optional template components (header/body/button parameters)
   */
  components?: unknown[];
}

/**
 * @description Supported WhatsApp media message types
 * @summary The media kinds the Cloud API accepts in the message `type` field.
 * @category Comms
 * @memberOf module:integrations/comms/whatsapp/service
 */
export type WhatsAppMediaType = "image" | "audio" | "video" | "document";

/**
 * @description Input for sending a WhatsApp media message
 * @summary Carries the recipient, the media `type`, and either a previously
 * uploaded `mediaId` or a public `link` (one is required), plus an optional
 * `caption` and `filename`.
 * @category Comms
 * @memberOf module:integrations/comms/whatsapp/service
 */
export interface WhatsAppMediaInput {
  /**
   * @description Recipient phone number in international format
   */
  to: string;
  /**
   * @description Media kind sent in the message `type` field
   */
  type: WhatsAppMediaType;
  /**
   * @description ID of previously uploaded WhatsApp media
   */
  mediaId?: string;
  /**
   * @description Public URL of the media (alternative to `mediaId`)
   */
  link?: string;
  /**
   * @description Optional caption (images, videos, documents)
   */
  caption?: string;
  /**
   * @description Optional filename (documents)
   */
  filename?: string;
}

/**
 * @description Input for marking a WhatsApp message as read
 * @summary Carries the inbound `messageId` to acknowledge.
 * @category Comms
 * @memberOf module:integrations/comms/whatsapp/service
 */
export interface WhatsAppReadInput {
  /**
   * @description ID of the inbound message to mark read
   */
  messageId: string;
}

/**
 * @description WhatsApp Cloud API integration service
 * @summary An undecorated HTTP service for text, template, and media
 * messages, read receipts, and media metadata. Every message operation needs
 * both the access token and the sender phone number ID; missing credentials or
 * identifiers raise `InternalError`, and transport failures are mapped to decaf
 * errors via {@link httpError}.
 * @class WhatsAppService
 * @extends HttpApiService
 * @category Comms
 * @example
 * ```ts
 * import { WhatsAppService } from "@decaf-ts/integrations/comms/whatsapp";
 *
 * const whatsapp = new WhatsAppService();
 * await whatsapp.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_WHATSAPP_TOKEN,
 *   phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
 * });
 * await whatsapp.sendText({ to: "15551234567", text: "Hello" });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as WhatsAppService
 *   participant Graph as WhatsApp Cloud API
 *   Caller->>Service: sendText(input)
 *   activate Service
 *   Service->>Service: requireTokenAndPhone()
 *   Service->>Graph: POST /{phoneNumberId}/messages
 *   activate Graph
 *   Graph-->>Service: message payload
 *   deactivate Graph
 *   Service-->>Caller: message payload
 *   deactivate Service
 * @memberOf module:integrations/comms/whatsapp/service
 */
export class WhatsAppService extends HttpApiService<WhatsAppServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "WhatsApp";

  /**
   * @description The WhatsApp Cloud API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://graph.facebook.com/v19.0"`.
   */
  protected defaultBaseUrl(): string {
    return "https://graph.facebook.com/v19.0";
  }

  /**
   * @description Builds the WhatsApp bearer authorization headers
   * @summary Returns `Authorization: Bearer <token>` when configured, and no
   * headers otherwise.
   * @param {WhatsAppServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(
    config: WhatsAppServiceConfig
  ): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the WhatsApp credentials and defaults from the environment
   * @summary Reads the `comms.whatsApp` slice and returns a partial config
   * when a token or phone number ID is configured, `undefined` otherwise.
   * Values pass through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<WhatsAppServiceConfig> | undefined} A partial config, or `undefined` when neither credential is configured.
   */
  protected configFromEnvironment():
    | Partial<WhatsAppServiceConfig>
    | undefined {
    const env = CommsEnvironment.comms.whatsApp;
    const token = envString(env?.token);
    const phoneNumberId = envString(env?.phoneNumberId);
    if (!token && !phoneNumberId) return undefined;
    return {
      token,
      phoneNumberId,
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts the access token and sender phone number ID
   * @summary Calls `requireToken()` and returns the configured
   * `phoneNumberId` used to build the messages path.
   * @returns {string} The configured sender phone number ID.
   * @throws {InternalError} When no token or phone number ID is configured.
   */
  protected requireTokenAndPhone(): string {
    this.requireToken();
    const phoneNumberId = this.config.phoneNumberId;
    if (!phoneNumberId) {
      throw new InternalError("WhatsApp requires a phone number id");
    }
    return phoneNumberId;
  }

  /**
   * @description Builds the encoded messages path for a sender
   * @summary Encodes the phone number ID into `/<id>/messages`.
   * @param {string} phoneNumberId - The sender phone number ID.
   * @returns {string} The messages API path.
   */
  private messagesPath(phoneNumberId: string): string {
    return `/${encodeURIComponent(phoneNumberId)}/messages`;
  }

  /**
   * @description Sends a WhatsApp text message
   * @summary `POST`s a `text` message to the sender's `/messages` endpoint
   * and returns the WhatsApp message payload.
   * @param {WhatsAppTextInput} input - The recipient, text, and preview flag.
   * @returns {Promise<unknown>} The WhatsApp message payload.
   * @throws {InternalError} When credentials or the phone number ID are missing.
   * @throws {BadRequestError} When WhatsApp rejects the message.
   * @example
   * ```ts
   * await whatsapp.sendText({ to: "15551234567", text: "Deployment finished" });
   * ```
   */
  async sendText(input: WhatsAppTextInput): Promise<unknown> {
    const phoneNumberId = this.requireTokenAndPhone();
    try {
      const response = await this.client.post(
        this.messagesPath(phoneNumberId),
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "text",
          text: {
            body: input.text,
            preview_url: input.previewUrl ?? false,
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("WhatsApp", "send text message", error);
    }
  }

  /**
   * @description Sends a WhatsApp template message
   * @summary `POST`s a `template` message referencing an approved template
   * name and language, with optional components.
   * @param {WhatsAppTemplateInput} input - The recipient and template definition.
   * @returns {Promise<unknown>} The WhatsApp message payload.
   * @throws {InternalError} When credentials or the phone number ID are missing.
   * @throws {BadRequestError} When WhatsApp rejects the template message.
   */
  async sendTemplate(input: WhatsAppTemplateInput): Promise<unknown> {
    const phoneNumberId = this.requireTokenAndPhone();
    try {
      const response = await this.client.post(
        this.messagesPath(phoneNumberId),
        {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.languageCode },
            ...(input.components ? { components: input.components } : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("WhatsApp", "send template message", error);
    }
  }

  /**
   * @description Sends a WhatsApp media message
   * @summary `POST`s an `image`/`audio`/`video`/`document` message using
   * either an uploaded `mediaId` or a public `link`, with optional caption and
   * filename.
   * @param {WhatsAppMediaInput} input - The recipient and media reference.
   * @returns {Promise<unknown>} The WhatsApp message payload.
   * @throws {InternalError} When credentials or the phone number ID are missing, or neither `mediaId` nor `link` is provided.
   * @throws {BadRequestError} When WhatsApp rejects the media message.
   */
  async sendMedia(input: WhatsAppMediaInput): Promise<unknown> {
    const phoneNumberId = this.requireTokenAndPhone();
    if (!input.mediaId && !input.link) {
      throw new InternalError(
        "WhatsApp media messages require a media id or link"
      );
    }
    try {
      const response = await this.client.post(
        this.messagesPath(phoneNumberId),
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: input.type,
          [input.type]: {
            ...(input.mediaId ? { id: input.mediaId } : { link: input.link }),
            ...(input.caption ? { caption: input.caption } : {}),
            ...(input.filename ? { filename: input.filename } : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("WhatsApp", "send media message", error);
    }
  }

  /**
   * @description Marks an inbound WhatsApp message as read
   * @summary `POST`s a `read` status for the message to the sender's
   * `/messages` endpoint.
   * @param {WhatsAppReadInput} input - The inbound message ID to acknowledge.
   * @returns {Promise<unknown>} The WhatsApp status payload.
   * @throws {InternalError} When credentials, the phone number ID, or the message ID are missing.
   * @throws {BadRequestError} When WhatsApp rejects the request.
   */
  async markAsRead(input: WhatsAppReadInput): Promise<unknown> {
    const phoneNumberId = this.requireTokenAndPhone();
    if (!input.messageId) {
      throw new InternalError("WhatsApp requires a message id");
    }
    try {
      const response = await this.client.post(
        this.messagesPath(phoneNumberId),
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("WhatsApp", "mark message as read", error);
    }
  }

  /**
   * @description Fetches WhatsApp media metadata
   * @summary `GET`s the media descriptor (URL, MIME type, size) by media ID;
   * the descriptor's URL is then used to download the binary.
   * @param {string} mediaId - The WhatsApp media ID.
   * @returns {Promise<unknown>} The media metadata payload.
   * @throws {InternalError} When no token is configured or the media ID is empty.
   * @throws {NotFoundError} When the media does not exist (HTTP 404).
   * @throws {BadRequestError} When WhatsApp rejects the request.
   */
  async getMedia(mediaId: string): Promise<unknown> {
    this.requireToken();
    if (!mediaId) {
      throw new InternalError("WhatsApp requires a media id");
    }
    try {
      const response = await this.client.get(
        `/${encodeURIComponent(mediaId)}`
      );
      return response.data;
    } catch (error) {
      throw httpError("WhatsApp", "get media", error);
    }
  }
}
