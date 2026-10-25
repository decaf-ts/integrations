/**
 * @module integrations/io/microsoft-sharepoint/service
 * @summary Microsoft SharePoint integration service (Microsoft Graph).
 * @description Exposes SharePoint site, list, list-item, and drive-item
 * operations through Microsoft Graph `v1.0` as an undecorated client-based
 * service built on {@link HttpApiService}. Configuration comes from an explicit
 * `MicrosoftSharePointServiceConfig` or the `io.microsoftSharePoint` environment
 * slice; the access token is sent as `Authorization: Bearer <token>`.
 * Credentials are referenced from configuration (and, from as-graph nodes, from
 * the resolved `microsoft-sharepoint` credential secret) and are never embedded
 * in source. Failures are mapped to decaf errors via {@link httpError}.
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
 * @description Configuration for the Microsoft SharePoint service
 * @summary Extends {@link HttpApiServiceConfig} with the Microsoft Graph
 * access token sent as a bearer token. When omitted, the
 * `io.microsoftSharePoint` environment slice supplies the token (plus optional
 * `baseUrl`/`timeout`).
 * @category IO
 * @memberOf module:integrations/io/microsoft-sharepoint/service
 */
export interface MicrosoftSharePointServiceConfig
  extends HttpApiServiceConfig {
  /**
   * @description Microsoft Graph access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
}

/**
 * @description Input for listing SharePoint list items
 * @summary Carries the owning `siteId`, the `listId`, and optional `top` and
 * `filter` query options.
 * @category IO
 * @memberOf module:integrations/io/microsoft-sharepoint/service
 */
export interface SharePointItemsInput {
  /**
   * @description SharePoint site ID
   */
  siteId: string;
  /**
   * @description List ID within the site
   */
  listId: string;
  /**
   * @description Maximum number of items to return (`$top`)
   */
  top?: number;
  /**
   * @description OData filter expression (`$filter`)
   */
  filter?: string;
}

/**
 * @description Input for creating a SharePoint list item
 * @summary Carries the owning `siteId`, the `listId`, and the item `fields`
 * map to write.
 * @category IO
 * @memberOf module:integrations/io/microsoft-sharepoint/service
 */
export interface SharePointListItemInput {
  /**
   * @description SharePoint site ID
   */
  siteId: string;
  /**
   * @description List ID within the site
   */
  listId: string;
  /**
   * @description Column values for the new item
   */
  fields: Record<string, unknown>;
}

/**
 * @description Input for listing a SharePoint drive folder's children
 * @summary Carries the `siteId`, an optional folder `itemId` (default `root`),
 * and an optional `top` cap.
 * @category IO
 * @memberOf module:integrations/io/microsoft-sharepoint/service
 */
export interface SharePointDriveItemsInput {
  /**
   * @description SharePoint site ID
   */
  siteId: string;
  /**
   * @description Drive item (folder) ID; defaults to the drive root
   */
  itemId?: string;
  /**
   * @description Maximum number of children to return (`$top`)
   */
  top?: number;
}

/**
 * @description Microsoft SharePoint (Graph) integration service
 * @summary An undecorated HTTP service for searching sites, reading a site's
 * lists and list items, creating list items, and listing drive folder
 * contents. Every operation requires a Graph access token; missing credentials
 * or identifiers raise `InternalError`, and transport failures are mapped to
 * decaf errors via {@link httpError}.
 * @class MicrosoftSharePointService
 * @extends HttpApiService
 * @category IO
 * @example
 * ```ts
 * import { MicrosoftSharePointService } from "@decaf-ts/integrations/io/microsoft-sharepoint";
 *
 * const sharepoint = new MicrosoftSharePointService();
 * await sharepoint.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_MICROSOFT_SHAREPOINT_TOKEN,
 * });
 * const sites = await sharepoint.listSites("ops");
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as MicrosoftSharePointService
 *   participant Graph as Microsoft Graph
 *   Caller->>Service: listItems(input)
 *   activate Service
 *   Service->>Service: requireAccessToken()
 *   Service->>Graph: GET /sites/{siteId}/lists/{listId}/items
 *   activate Graph
 *   Graph-->>Service: list items payload
 *   deactivate Graph
 *   Service-->>Caller: list items payload
 *   deactivate Service
 * @memberOf module:integrations/io/microsoft-sharepoint/service
 */
export class MicrosoftSharePointService extends HttpApiService<MicrosoftSharePointServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Microsoft SharePoint";

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
   * @param {MicrosoftSharePointServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(
    config: MicrosoftSharePointServiceConfig
  ): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the SharePoint credentials and defaults from the environment
   * @summary Reads the `io.microsoftSharePoint` slice and returns a partial
   * config when an access token is configured, `undefined` otherwise. Values
   * pass through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<MicrosoftSharePointServiceConfig> | undefined} A partial config, or `undefined` when no SharePoint token is configured.
   */
  protected configFromEnvironment():
    | Partial<MicrosoftSharePointServiceConfig>
    | undefined {
    const env = IoEnvironment.io.microsoftSharePoint;
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
   * @description Builds the encoded path for a SharePoint site
   * @summary Validates the site ID and URL-encodes it into `/sites/<id>`.
   * @param {string} siteId - The SharePoint site ID.
   * @returns {string} The site API path.
   * @throws {InternalError} When `siteId` is empty.
   */
  private sitePath(siteId: string): string {
    if (!siteId) {
      throw new InternalError("Microsoft SharePoint requires a site id");
    }
    return `/sites/${encodeURIComponent(siteId)}`;
  }

  /**
   * @description Searches SharePoint sites
   * @summary `GET`s `/sites` with a `search` term (default `"*"`).
   * @param {string} [search] - Site search term; defaults to `"*"`.
   * @returns {Promise<unknown>} The site collection payload.
   * @throws {InternalError} When no token is configured.
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async listSites(search = "*"): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get("/sites", {
        params: { search },
      });
      return response.data;
    } catch (error) {
      throw httpError("Microsoft SharePoint", "list sites", error);
    }
  }

  /**
   * @description Fetches a SharePoint site
   * @summary `GET`s `/sites/<id>` and returns the site payload.
   * @param {string} siteId - The site ID to fetch.
   * @returns {Promise<unknown>} The site payload.
   * @throws {InternalError} When no token is configured or the site ID is empty.
   * @throws {NotFoundError} When the site does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async getSite(siteId: string): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get(this.sitePath(siteId));
      return response.data;
    } catch (error) {
      throw httpError("Microsoft SharePoint", "get site", error);
    }
  }

  /**
   * @description Lists the lists in a SharePoint site
   * @summary `GET`s `/sites/<id>/lists`.
   * @param {string} siteId - The site whose lists are listed.
   * @returns {Promise<unknown>} The list collection payload.
   * @throws {InternalError} When no token is configured or the site ID is empty.
   * @throws {NotFoundError} When the site does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async listLists(siteId: string): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get(
        `${this.sitePath(siteId)}/lists`
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft SharePoint", "list lists", error);
    }
  }

  /**
   * @description Lists items in a SharePoint list
   * @summary `GET`s the list's `/items` endpoint expanding `fields` and
   * applying the optional `$top` and `$filter` options.
   * @param {SharePointItemsInput} input - The site, list, and query options.
   * @returns {Promise<unknown>} The list item collection payload.
   * @throws {InternalError} When no token is configured, or the site or list ID is empty.
   * @throws {NotFoundError} When the site or list does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the query.
   */
  async listItems(input: SharePointItemsInput): Promise<unknown> {
    this.requireAccessToken();
    if (!input.listId) {
      throw new InternalError(
        "Microsoft SharePoint requires a list id"
      );
    }
    try {
      const response = await this.client.get(
        `${this.sitePath(input.siteId)}/lists/${encodeURIComponent(
          input.listId
        )}/items`,
        {
          params: {
            $expand: "fields",
            ...(input.top !== undefined ? { $top: input.top } : {}),
            ...(input.filter ? { $filter: input.filter } : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft SharePoint", "list items", error);
    }
  }

  /**
   * @description Creates a SharePoint list item
   * @summary `POST`s the `fields` map to the list's `/items` endpoint.
   * @param {SharePointListItemInput} input - The site, list, and item fields.
   * @returns {Promise<unknown>} The created item payload.
   * @throws {InternalError} When no token is configured, or the site, list, or fields are missing.
   * @throws {NotFoundError} When the site or list does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the item.
   */
  async createListItem(input: SharePointListItemInput): Promise<unknown> {
    this.requireAccessToken();
    if (!input.listId || !input.fields) {
      throw new InternalError(
        "Microsoft SharePoint createListItem requires a list id and fields"
      );
    }
    try {
      const response = await this.client.post(
        `${this.sitePath(input.siteId)}/lists/${encodeURIComponent(
          input.listId
        )}/items`,
        { fields: input.fields }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft SharePoint", "create list item", error);
    }
  }

  /**
   * @description Lists the children of a SharePoint drive folder
   * @summary `GET`s `/sites/<id>/drive/items/<item or root>/children` with an
   * optional `$top` cap.
   * @param {SharePointDriveItemsInput} input - The site, folder, and result cap.
   * @returns {Promise<unknown>} The drive item collection payload.
   * @throws {InternalError} When no token is configured or the site ID is empty.
   * @throws {NotFoundError} When the site or folder does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async listDriveItems(input: SharePointDriveItemsInput): Promise<unknown> {
    this.requireAccessToken();
    const item = input.itemId ? encodeURIComponent(input.itemId) : "root";
    try {
      const response = await this.client.get(
        `${this.sitePath(input.siteId)}/drive/items/${item}/children`,
        {
          params: {
            ...(input.top !== undefined ? { $top: input.top } : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft SharePoint", "list drive items", error);
    }
  }
}
