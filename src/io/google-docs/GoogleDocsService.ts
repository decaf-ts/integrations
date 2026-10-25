/**
 * @module integrations/io/google-docs/service
 * @summary Google Docs API integration service for document content operations.
 * @description Exposes Google Docs document operations (get, create, batch
 * update, append text, and replace-all) as an undecorated client-based service
 * built on {@link HttpApiService}. Configuration comes from an explicit
 * `GoogleDocsServiceConfig` or the `io.googleDocs` environment slice. An OAuth
 * access token is sent as a bearer token when present; otherwise an API key is
 * sent as `X-Goog-Api-Key` (writes generally require OAuth). Credentials are
 * referenced from configuration (and, from as-graph nodes, from the resolved
 * `google-docs` credential secret) and are never embedded in source. Failures
 * are mapped to decaf errors via {@link httpError}.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { IoEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the Google Docs service
 * @summary Extends {@link HttpApiServiceConfig} with an optional OAuth
 * `token` (preferred) and an optional `apiKey`. When omitted, the
 * `io.googleDocs` environment slice supplies the same values (plus optional
 * `baseUrl`/`timeout`). At least one credential is required; the token wins
 * when both are set.
 * @category IO
 * @memberOf module:integrations/io/google-docs/service
 */
export interface GoogleDocsServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Google OAuth access token
   * @summary Sent as `Authorization: Bearer <token>` when present.
   */
  token?: string;
  /**
   * @description Google API key
   * @summary Sent as `X-Goog-Api-Key` only when no OAuth token is configured.
   */
  apiKey?: string;
}

/**
 * @description Input for replacing all matching text in a document
 * @summary Carries the `documentId`, the `find` text, its `replace`ment, and
 * whether matching is case-sensitive.
 * @category IO
 * @memberOf module:integrations/io/google-docs/service
 */
export interface GoogleDocsReplaceInput {
  /**
   * @description Document ID to update
   */
  documentId: string;
  /**
   * @description Text to search for
   */
  find: string;
  /**
   * @description Replacement text (defaults to the empty string)
   */
  replace: string;
  /**
   * @description Whether matching is case-sensitive (default `false`)
   */
  matchCase?: boolean;
}

/**
 * @description Minimal Google Docs body descriptor used for append positioning
 * @summary Captures the body content entries whose `endIndex` locates the end
 * of the document.
 */
interface GoogleDocBody {
  body?: {
    content?: Array<{ endIndex?: number }>;
  };
}

/**
 * @description Google Docs API integration service
 * @summary An undecorated HTTP service for reading and creating documents,
 * running raw batch updates, appending text, and replacing all matching text.
 * Every operation needs either an OAuth token or an API key; missing
 * credentials or identifiers raise `InternalError`, and transport failures are
 * mapped to decaf errors via {@link httpError}.
 * @class GoogleDocsService
 * @extends HttpApiService
 * @category IO
 * @example
 * ```ts
 * import { GoogleDocsService } from "@decaf-ts/integrations/io/google-docs";
 *
 * const docs = new GoogleDocsService();
 * await docs.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_GOOGLE_DOCS_TOKEN,
 * });
 * await docs.appendText(process.env.GOOGLE_DOC_ID ?? "", "New paragraph");
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as GoogleDocsService
 *   participant API as Google Docs API
 *   Caller->>Service: appendText(documentId, text)
 *   activate Service
 *   Service->>Service: requireAuth()
 *   Service->>API: GET /documents/{id}
 *   activate API
 *   API-->>Service: body content endIndex
 *   deactivate API
 *   Service->>API: POST /documents/{id}:batchUpdate
 *   activate API
 *   API-->>Service: batch update result
 *   deactivate API
 *   Service-->>Caller: batch update result
 *   deactivate Service
 * @memberOf module:integrations/io/google-docs/service
 */
export class GoogleDocsService extends HttpApiService<GoogleDocsServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Google Docs";

  /**
   * @description The Google Docs API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://docs.googleapis.com/v1"`.
   */
  protected defaultBaseUrl(): string {
    return "https://docs.googleapis.com/v1";
  }

  /**
   * @description Builds the Google Docs authentication headers
   * @summary Prefers `Authorization: Bearer <token>`, falls back to
   * `X-Goog-Api-Key: <apiKey>`, and returns no headers when neither is set.
   * @param {GoogleDocsServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authentication headers.
   */
  protected authHeaders(
    config: GoogleDocsServiceConfig
  ): Record<string, string> {
    if (config.token) return { Authorization: `Bearer ${config.token}` };
    if (config.apiKey) return { "X-Goog-Api-Key": config.apiKey };
    return {};
  }

  /**
   * @description Reads the Google Docs credentials and defaults from the environment
   * @summary Reads the `io.googleDocs` slice and returns a partial config when
   * a token or API key is configured, `undefined` otherwise. Values pass
   * through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<GoogleDocsServiceConfig> | undefined} A partial config, or `undefined` when no credential is configured.
   */
  protected configFromEnvironment():
    | Partial<GoogleDocsServiceConfig>
    | undefined {
    const env = IoEnvironment.io.googleDocs;
    const token = envString(env?.token);
    const apiKey = envString(env?.apiKey);
    if (!token && !apiKey) return undefined;
    return {
      token,
      apiKey,
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts that an OAuth token or API key is configured
   * @summary Called by every operation before it touches the network.
   * @returns {void}
   * @throws {InternalError} When neither a token nor an API key is configured.
   */
  protected requireAuth(): void {
    if (!this.config.token && !this.config.apiKey) {
      throw new InternalError(
        "Google Docs requires an OAuth token or an API key"
      );
    }
  }

  /**
   * @description Fetches a Google Docs document
   * @summary `GET`s `/documents/<id>` and returns the full document payload.
   * @param {string} documentId - The document ID.
   * @returns {Promise<unknown>} The document payload.
   * @throws {InternalError} When no credential is configured or the document ID is empty.
   * @throws {NotFoundError} When the document does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the request.
   */
  async getDocument(documentId: string): Promise<unknown> {
    this.requireAuth();
    if (!documentId) {
      throw new InternalError("Google Docs requires a document id");
    }
    try {
      const response = await this.client.get<GoogleDocBody>(
        `/documents/${encodeURIComponent(documentId)}`
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Docs", "get document", error);
    }
  }

  /**
   * @description Creates a Google Docs document
   * @summary `POST`s a new document with the given title and returns its
   * payload (including `documentId`).
   * @param {string} title - The new document title.
   * @returns {Promise<unknown>} The created document payload.
   * @throws {InternalError} When no credential is configured or the title is empty.
   * @throws {BadRequestError} When Google rejects the request.
   */
  async createDocument(title: string): Promise<unknown> {
    this.requireAuth();
    if (!title) {
      throw new InternalError("Google Docs requires a document title");
    }
    try {
      const response = await this.client.post("/documents", { title });
      return response.data;
    } catch (error) {
      throw httpError("Google Docs", "create document", error);
    }
  }

  /**
   * @description Applies a raw Google Docs batch update
   * @summary `POST`s the `requests` array to `/documents/<id>:batchUpdate`
   * unchanged, allowing any Docs API request type.
   * @param {string} documentId - The document ID.
   * @param {unknown[]} requests - The Docs API request objects.
   * @returns {Promise<unknown>} The batch update response payload.
   * @throws {InternalError} When no credential is configured, or the document ID or requests are missing.
   * @throws {NotFoundError} When the document does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects a request.
   */
  async batchUpdate(
    documentId: string,
    requests: unknown[]
  ): Promise<unknown> {
    this.requireAuth();
    if (!documentId || !Array.isArray(requests) || !requests.length) {
      throw new InternalError(
        "Google Docs batchUpdate requires a document id and requests"
      );
    }
    try {
      const response = await this.client.post(
        `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        { requests }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Docs", "batch update", error);
    }
  }

  /**
   * @description Appends text to the end of a Google Docs document
   * @summary Reads the document to find the final `endIndex`, then inserts the
   * text just before it through a `batchUpdate`.
   * @param {string} documentId - The document ID.
   * @param {string} text - The text to append.
   * @returns {Promise<unknown>} The batch update response payload.
   * @throws {InternalError} When no credential is configured, or the document ID or text is empty.
   * @throws {NotFoundError} When the document does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the update.
   */
  async appendText(documentId: string, text: string): Promise<unknown> {
    this.requireAuth();
    if (!documentId || !text) {
      throw new InternalError(
        "Google Docs appendText requires a document id and text"
      );
    }
    try {
      const document = await this.client.get<GoogleDocBody>(
        `/documents/${encodeURIComponent(documentId)}`
      );
      const content = document.data.body?.content ?? [];
      const last = content[content.length - 1];
      const endIndex = last?.endIndex ?? 1;
      const response = await this.client.post(
        `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        {
          requests: [
            {
              insertText: {
                location: { index: Math.max(endIndex - 1, 1) },
                text,
              },
            },
          ],
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Docs", "append text", error);
    }
  }

  /**
   * @description Replaces all matching text in a Google Docs document
   * @summary Sends a `replaceAllText` request honoring the `matchCase` option
   * and returns the batch update response payload.
   * @param {GoogleDocsReplaceInput} input - The document, find/replace text, and case option.
   * @returns {Promise<unknown>} The batch update response payload.
   * @throws {InternalError} When no credential is configured, or the document ID or find text is empty.
   * @throws {NotFoundError} When the document does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the update.
   * @example
   * ```ts
   * await docs.replaceAllText({
   *   documentId: "abc123",
   *   find: "TODO",
   *   replace: "DONE",
   *   matchCase: true,
   * });
   * ```
   */
  async replaceAllText(input: GoogleDocsReplaceInput): Promise<unknown> {
    this.requireAuth();
    if (!input.documentId || !input.find) {
      throw new InternalError(
        "Google Docs replaceAllText requires a document id and find text"
      );
    }
    try {
      const response = await this.client.post(
        `/documents/${encodeURIComponent(input.documentId)}:batchUpdate`,
        {
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: input.find,
                  matchCase: input.matchCase ?? false,
                },
                replaceText: input.replace ?? "",
              },
            },
          ],
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Docs", "replace all text", error);
    }
  }
}
