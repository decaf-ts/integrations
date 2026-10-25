/**
 * @module integrations/io/confluence/service
 * @summary Confluence REST API integration service for spaces and pages.
 * @description Exposes Confluence content operations (spaces, pages, and CQL
 * search) as an undecorated client-based service built on
 * {@link HttpApiService}. Configuration comes from an explicit
 * `ConfluenceServiceConfig` or the `io.confluence` environment slice. When both
 * `username` and `token` are configured the service sends HTTP Basic
 * authentication (API token as the password); otherwise the token is sent as a
 * bearer token. The site `baseUrl` is required. Credentials are referenced from
 * configuration (and, from as-graph nodes, from the resolved `confluence`
 * credential secret) and are never embedded in source. Failures are mapped to
 * decaf errors via {@link httpError}.
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
 * @description Configuration for the Confluence service
 * @summary Extends {@link HttpApiServiceConfig} with the API `token`, the
 * optional `username` that enables Basic authentication, and the required
 * site `baseUrl`. When omitted, the `io.confluence` environment slice supplies
 * the same values (plus optional `timeout`).
 * @category IO
 * @memberOf module:integrations/io/confluence/service
 */
export interface ConfluenceServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Confluence API token
   * @summary Used as the Basic-auth password when `username` is set, otherwise as a bearer token.
   */
  token?: string;
  /**
   * @description Confluence account username for Basic authentication
   */
  username?: string;
}

/**
 * @description Input for creating a Confluence page
 * @summary Carries the target `spaceKey`, page `title`, storage-format body,
 * and optional `parentId` of the ancestor page.
 * @category IO
 * @memberOf module:integrations/io/confluence/service
 */
export interface ConfluencePageInput {
  /**
   * @description Space key that owns the new page
   */
  spaceKey: string;
  /**
   * @description Page title (unique within the space)
   */
  title: string;
  /**
   * @description Page body in Confluence storage format
   */
  body: string;
  /**
   * @description Optional parent page ID
   */
  parentId?: string;
}

/**
 * @description Input for updating a Confluence page
 * @summary Carries the `pageId`, new `title` and storage-format body, and an
 * optional `version`. When `version` is omitted the service fetches the
 * current version and submits the next one.
 * @category IO
 * @memberOf module:integrations/io/confluence/service
 */
export interface ConfluencePageUpdate {
  /**
   * @description ID of the page to update
   */
  pageId: string;
  /**
   * @description New page title
   */
  title: string;
  /**
   * @description New page body in Confluence storage format
   */
  body: string;
  /**
   * @description Explicit new version number (auto-incremented when omitted)
   */
  version?: number;
}

/**
 * @description Input for a Confluence CQL search
 * @summary Carries the `cql` query and an optional result `limit`.
 * @category IO
 * @memberOf module:integrations/io/confluence/service
 */
export interface ConfluenceSearchInput {
  /**
   * @description Confluence Query Language expression
   */
  cql: string;
  /**
   * @description Maximum number of results
   */
  limit?: number;
}

/**
 * @description Minimal Confluence content descriptor used for version lookup
 * @summary Captures the identity and version number read before an update.
 */
interface ConfluencePage {
  id?: string;
  title?: string;
  version?: { number?: number };
}

/** Default Confluence content type written by the service (`"page"`). */
const DEFAULT_PAGE_TYPE = "page";

/**
 * @description Confluence REST API integration service
 * @summary An undecorated HTTP service for reading, creating, updating, and
 * deleting pages, listing spaces, and running CQL searches. The site base URL
 * and API token are required; supplying a `username` switches authentication to
 * Basic, and transport failures are mapped to decaf errors via
 * {@link httpError}.
 * @class ConfluenceService
 * @extends HttpApiService
 * @category IO
 * @example
 * ```ts
 * import { ConfluenceService } from "@decaf-ts/integrations/io/confluence";
 *
 * const confluence = new ConfluenceService();
 * await confluence.initialize({
 *   baseUrl: "https://example.atlassian.net/wiki",
 *   username: process.env.CONFLUENCE_USERNAME,
 *   token: process.env.GRAPH_CREDENTIAL_CONFLUENCE_TOKEN,
 * });
 * const page = await confluence.getPage("123456");
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as ConfluenceService
 *   participant API as Confluence REST API
 *   Caller->>Service: updatePage(input)
 *   activate Service
 *   Service->>Service: requireCredentials()
 *   opt version omitted
 *     Service->>API: GET /rest/api/content/{id}?expand=version
 *     activate API
 *     API-->>Service: current version
 *     deactivate API
 *   end
 *   Service->>API: PUT /rest/api/content/{id}
 *   activate API
 *   API-->>Service: updated page
 *   deactivate API
 *   Service-->>Caller: updated page
 *   deactivate Service
 * @memberOf module:integrations/io/confluence/service
 */
export class ConfluenceService extends HttpApiService<ConfluenceServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Confluence";

  /**
   * @description The default base URL for Confluence
   * @summary Returns an empty string; Confluence is site-hosted, so the
   * resolved `baseUrl` (from config or `io.confluence.baseUrl`) is required.
   * @returns {string} An empty string.
   */
  protected defaultBaseUrl(): string {
    return "";
  }

  /**
   * @description Builds the Confluence authentication headers
   * @summary Uses HTTP Basic (`username:token`) when both values are present,
   * otherwise a bearer token when only `token` is present, otherwise no
   * headers.
   * @param {ConfluenceServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers.
   */
  protected authHeaders(
    config: ConfluenceServiceConfig
  ): Record<string, string> {
    if (config.username && config.token) {
      const encoded = Buffer.from(
        `${config.username}:${config.token}`,
        "utf8"
      ).toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Confluence credentials and defaults from the environment
   * @summary Reads the `io.confluence` slice and returns a partial config when
   * an API token is configured, `undefined` otherwise. Values pass through
   * `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<ConfluenceServiceConfig> | undefined} A partial config, or `undefined` when no Confluence token is configured.
   */
  protected configFromEnvironment():
    | Partial<ConfluenceServiceConfig>
    | undefined {
    const env = IoEnvironment.io.confluence;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      username: envString(env.username),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts that the Confluence token and site base URL are configured
   * @summary Called by every operation before it touches the network.
   * @returns {void}
   * @throws {InternalError} When no API token or base URL is configured.
   */
  protected requireCredentials(): void {
    if (!this.config.token) {
      throw new InternalError("Confluence requires an API token");
    }
    if (!this.config.baseUrl) {
      throw new InternalError("Confluence requires a base URL");
    }
  }

  /**
   * @description Wraps a body in the Confluence storage representation
   * @summary Produces the `{ storage: { value, representation } }` envelope
   * the content API expects.
   * @param {string} body - The Confluence storage-format body.
   * @returns {Record<string, unknown>} The storage body envelope.
   */
  private storageBody(body: string): Record<string, unknown> {
    return {
      storage: {
        value: body,
        representation: "storage",
      },
    };
  }

  /**
   * @description Fetches a Confluence page
   * @summary `GET`s `/rest/api/content/<id>` with the requested `expand`
   * fields (default `body.storage,version`).
   * @param {string} pageId - The page ID.
   * @param {string} [expand] - Comma-separated fields to expand; defaults to `"body.storage,version"`.
   * @returns {Promise<unknown>} The page payload.
   * @throws {InternalError} When credentials are missing or the page ID is empty.
   * @throws {NotFoundError} When the page does not exist (HTTP 404).
   * @throws {BadRequestError} When the API rejects the request.
   */
  async getPage(pageId: string, expand = "body.storage,version"): Promise<unknown> {
    this.requireCredentials();
    if (!pageId) {
      throw new InternalError("Confluence requires a page id");
    }
    try {
      const response = await this.client.get(
        `/rest/api/content/${encodeURIComponent(pageId)}`,
        { params: { expand } }
      );
      return response.data;
    } catch (error) {
      throw httpError("Confluence", "get page", error);
    }
  }

  /**
   * @description Lists Confluence spaces
   * @summary `GET`s `/rest/api/space` with a result `limit` (default `25`).
   * @param {number} [limit] - Maximum number of spaces to return; defaults to `25`.
   * @returns {Promise<unknown>} The space collection payload.
   * @throws {InternalError} When credentials are missing.
   * @throws {BadRequestError} When the API rejects the request.
   */
  async listSpaces(limit = 25): Promise<unknown> {
    this.requireCredentials();
    try {
      const response = await this.client.get("/rest/api/space", {
        params: { limit },
      });
      return response.data;
    } catch (error) {
      throw httpError("Confluence", "list spaces", error);
    }
  }

  /**
   * @description Creates a Confluence page
   * @summary `POST`s a `page` content entry in the target space, optionally
   * under a parent, with the body in storage format.
   * @param {ConfluencePageInput} input - The space, title, body, and optional parent.
   * @returns {Promise<unknown>} The created page payload.
   * @throws {InternalError} When credentials are missing, or the space key or title is empty.
   * @throws {BadRequestError} When the API rejects the page.
   * @example
   * ```ts
   * await confluence.createPage({
   *   spaceKey: "OPS",
   *   title: "Release 1.2.0",
   *   body: "<p>Details…</p>",
   * });
   * ```
   */
  async createPage(input: ConfluencePageInput): Promise<unknown> {
    this.requireCredentials();
    if (!input.spaceKey || !input.title) {
      throw new InternalError(
        "Confluence createPage requires a space key and title"
      );
    }
    try {
      const response = await this.client.post("/rest/api/content", {
        type: DEFAULT_PAGE_TYPE,
        title: input.title,
        space: { key: input.spaceKey },
        ...(input.parentId ? { ancestors: [{ id: input.parentId }] } : {}),
        body: this.storageBody(input.body ?? ""),
      });
      return response.data;
    } catch (error) {
      throw httpError("Confluence", "create page", error);
    }
  }

  /**
   * @description Updates a Confluence page
   * @summary `PUT`s the new title and storage body. When `version` is omitted
   * the current version is read first and the next number is submitted, as
   * Confluence requires optimistic versioning.
   * @param {ConfluencePageUpdate} input - The page, new title/body, and optional version.
   * @returns {Promise<unknown>} The updated page payload.
   * @throws {InternalError} When credentials are missing, or the page ID or title is empty.
   * @throws {NotFoundError} When the page does not exist (HTTP 404).
   * @throws {ConflictError} When the submitted version is stale (HTTP 409).
   * @throws {BadRequestError} When the API rejects the update.
   */
  async updatePage(input: ConfluencePageUpdate): Promise<unknown> {
    this.requireCredentials();
    if (!input.pageId || !input.title) {
      throw new InternalError(
        "Confluence updatePage requires a page id and title"
      );
    }
    try {
      let version = input.version;
      if (version === undefined) {
        const current = await this.client.get<ConfluencePage>(
          `/rest/api/content/${encodeURIComponent(input.pageId)}`,
          { params: { expand: "version" } }
        );
        version = (current.data.version?.number ?? 0) + 1;
      }
      const response = await this.client.put(
        `/rest/api/content/${encodeURIComponent(input.pageId)}`,
        {
          id: input.pageId,
          type: DEFAULT_PAGE_TYPE,
          title: input.title,
          version: { number: version },
          body: this.storageBody(input.body ?? ""),
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Confluence", "update page", error);
    }
  }

  /**
   * @description Deletes a Confluence page
   * @summary `DELETE`s the content entry and returns `{ deleted: true, pageId }`.
   * @param {string} pageId - The page ID to delete.
   * @returns {Promise<unknown>} `{ deleted: true, pageId }` on success.
   * @throws {InternalError} When credentials are missing or the page ID is empty.
   * @throws {NotFoundError} When the page does not exist (HTTP 404).
   * @throws {BadRequestError} When the API rejects the deletion.
   */
  async deletePage(pageId: string): Promise<unknown> {
    this.requireCredentials();
    if (!pageId) {
      throw new InternalError("Confluence requires a page id");
    }
    try {
      await this.client.delete(
        `/rest/api/content/${encodeURIComponent(pageId)}`
      );
      return { deleted: true, pageId };
    } catch (error) {
      throw httpError("Confluence", "delete page", error);
    }
  }

  /**
   * @description Searches Confluence content with CQL
   * @summary `GET`s `/rest/api/content/search` with the CQL expression and an
   * optional `limit`.
   * @param {ConfluenceSearchInput} input - The CQL query and result limit.
   * @returns {Promise<unknown>} The search result payload.
   * @throws {InternalError} When credentials are missing or the CQL query is empty.
   * @throws {BadRequestError} When the CQL query is invalid.
   */
  async search(input: ConfluenceSearchInput): Promise<unknown> {
    this.requireCredentials();
    if (!input.cql) {
      throw new InternalError("Confluence search requires a CQL query");
    }
    try {
      const response = await this.client.get("/rest/api/content/search", {
        params: {
          cql: input.cql,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        },
      });
      return response.data;
    } catch (error) {
      throw httpError("Confluence", "search content", error);
    }
  }
}
