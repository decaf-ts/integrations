/**
 * @module integrations/io/airtable/service
 * @summary Airtable Web API integration service for CRUD operations on base records.
 * @description Exposes the Airtable v0 records API (list, get, create, update,
 * delete) as an undecorated client-based service built on
 * {@link HttpApiService}. Configuration comes from an explicit
 * `AirtableServiceConfig` or the `io.airtable` environment slice; base
 * targets default to the configured `baseId` and can be overridden per call.
 * Failures are mapped to decaf errors via {@link httpError}.
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
 * @description Configuration for the Airtable service
 * @summary Extends {@link HttpApiServiceConfig} with the Airtable personal
 * access token (sent as a bearer token) and the default `baseId` used when a
 * call does not override it. When omitted, the `io.airtable` environment
 * slice supplies the token (and optional `baseId`, `baseUrl`, `timeout`).
 * @category IO
 * @memberOf module:integrations/io/airtable/service
 */
export interface AirtableServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Airtable personal access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
  /**
   * @description Default base ID used when a call does not override it
   */
  baseId?: string;
}

/**
 * @description Normalized Airtable record descriptor
 * @summary The Airtable record envelope: the record `id`, the `fields` map
 * (column name to value), and the optional `createdTime` timestamp.
 * @category IO
 * @memberOf module:integrations/io/airtable/service
 */
export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}

/**
 * @description Options for listing Airtable records
 * @summary Carries the required `table` name plus the view, formula filter,
 * record caps and paging offset, field projection, and first-sort configuration
 * Airtable supports. Only the first sort entry is sent (Airtable's
 * `sort[0][field]`/`sort[0][direction]` query parameters); paging works by
 * passing the previous page's `offset` back as `offset`.
 * @category IO
 * @memberOf module:integrations/io/airtable/service
 */
export interface AirtableListOptions {
  /**
   * @description Table name or ID to list records from (required)
   */
  table: string;
  /**
   * @description View name or ID to restrict the listing to
   */
  view?: string;
  /**
   * @description Airtable formula restricting the returned records (e.g. `"{Status} = 'Active'"`)
   */
  filterByFormula?: string;
  /**
   * @description Maximum number of records to return in total
   */
  maxRecords?: number;
  /**
   * @description Number of records per page
   */
  pageSize?: number;
  /**
   * @description The `offset` from the previous page's result
   */
  offset?: string;
  /**
   * @description Column names to project
   */
  fields?: string[];
  /**
   * @description First sort entry applied to the listing
   */
  sort?: Array<{ field: string; direction?: "asc" | "desc" }>;
}

/**
 * @description Result of an Airtable record listing
 * @summary Carries the page of `records` and the `offset` cursor to pass back
 * as `AirtableListOptions.offset` when more pages exist.
 * @category IO
 * @memberOf module:integrations/io/airtable/service
 */
export interface AirtableListResult {
  records: AirtableRecord[];
  offset?: string;
}

/**
 * @description Input for creating or updating an Airtable record
 * @summary Carries the required `table` name, the `fields` map to write, and
 * the `typecast` flag letting Airtable convert values to the column types.
 * `updateRecord` additionally carries the `recordId`.
 * @category IO
 * @memberOf module:integrations/io/airtable/service
 */
export interface AirtableWriteInput {
  table: string;
  fields: Record<string, unknown>;
  typecast?: boolean;
}

/**
 * @description Airtable Web API integration service
 * @summary An undecorated HTTP service for listing records
 * with filtering, sorting, and cursor paging; fetching, creating, updating,
 * and deleting individual records. Base targets resolve per call from the
 * `baseId` argument, falling back to the configured value, and throw
 * `InternalError` when unresolved. Every operation requires a token
 * (`requireToken()`), and transport failures are mapped to decaf errors via
 * {@link httpError}.
 * @class AirtableService
 * @category IO
 * @example
 * ```ts
 * import { AirtableService } from "@decaf-ts/integrations/io/airtable";
 *
 * const airtable = new AirtableService();
 * await airtable.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_AIRTABLE_TOKEN,
 *   baseId: "appExampleBase",
 * });
 * const created = await airtable.createRecord({
 *   table: "Tasks",
 *   fields: { Name: "Ship release", Status: "Todo" },
 * });
 * ```
 * @memberOf module:integrations/io/airtable/service
 */
export class AirtableService extends HttpApiService<AirtableServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Airtable";

  /**
   * @description The Airtable Web API v0 base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://api.airtable.com/v0"`.
   */
  protected defaultBaseUrl(): string {
    return "https://api.airtable.com/v0";
  }

  /**
   * @description Builds the Airtable bearer authorization headers
   * @summary Returns the `Authorization: Bearer <token>` header when the
   * config carries a token, and no headers otherwise.
   * @param {AirtableServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: AirtableServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Airtable credentials and defaults from the environment
   * @summary Reads the `io.airtable` environment slice and returns a partial
   * config when a token is configured, `undefined` otherwise. Values pass
   * through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<AirtableServiceConfig> | undefined} A partial config, or `undefined` when no Airtable token is configured.
   */
  protected configFromEnvironment(): Partial<AirtableServiceConfig> | undefined {
    const env = IoEnvironment.io.airtable;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      baseId: envString(env.baseId),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Resolves the URL-encoded base path for a call
   * @summary Builds `/<baseId>` from the given base ID, falling back to the
   * configured value, and throws when neither is available.
   * @param {string} [baseId] - The per-call base override.
   * @returns {string} The URL-encoded base API path.
   * @throws {InternalError} When neither the input nor the config yields a base ID.
   */
  protected basePath(baseId?: string): string {
    const resolved = baseId ?? this.config.baseId;
    if (!resolved) {
      throw new InternalError("Airtable requires a base ID");
    }
    return `/${encodeURIComponent(resolved)}`;
  }

  /**
   * @description Resolves the URL-encoded table path for a call
   * @summary Builds `<basePath>/<table>` with both segments URL-encoded, and
   * throws when the table name is empty (or the base cannot be resolved).
   * @param {string} table - The table name or ID.
   * @param {string} [baseId] - The per-call base override.
   * @returns {string} The URL-encoded table API path.
   * @throws {InternalError} When the table name is empty or the base ID cannot be resolved.
   */
  protected tablePath(table: string, baseId?: string): string {
    if (!table) throw new InternalError("Airtable requires a table name");
    return `${this.basePath(baseId)}/${encodeURIComponent(table)}`;
  }

  /**
   * @description Lists records in an Airtable table with cursor paging
   * @summary `GET`s the table endpoint with the configured view, formula
   * filter, record caps, page size, page offset, field projection, and first
   * sort entry. Return the `offset` cursor as the next call's
   * `AirtableListOptions.offset` to fetch further pages.
   * @param {AirtableListOptions} options - The table and filter/sort/paging options.
   * @param {string} [baseId] - The base override; falls back to the configured `baseId`.
   * @returns {Promise<AirtableListResult>} The page of records and the next offset cursor when more pages exist.
   * @throws {InternalError} When no token is configured or the table/base cannot be resolved.
   * @throws {NotFoundError} When the base or table does not exist (HTTP 404).
   * @throws {ConflictError} When Airtable answers with HTTP 409.
   * @throws {BadRequestError} When Airtable answers with any other HTTP error status (e.g. invalid formula).
   * @example
   * ```ts
   * let offset: string | undefined;
   * do {
   *   const page = await airtable.listRecords({
   *     table: "Tasks",
   *     filterByFormula: "{Status} = 'Active'",
   *     pageSize: 100,
   *     offset,
   *     sort: [{ field: "Name", direction: "asc" }],
   *   });
   *   console.log(page.records);
   *   offset = page.offset;
   * } while (offset);
   * ```
   */
  async listRecords(
    options: AirtableListOptions,
    baseId?: string
  ): Promise<AirtableListResult> {
    this.requireToken();
    try {
      const response = await this.client.get<AirtableListResult>(
        this.tablePath(options.table, baseId),
        {
          params: {
            view: options.view,
            filterByFormula: options.filterByFormula,
            maxRecords: options.maxRecords,
            pageSize: options.pageSize,
            offset: options.offset,
            "fields[]": options.fields,
            "sort[0][field]": options.sort?.[0]?.field,
            "sort[0][direction]": options.sort?.[0]?.direction,
          },
        }
      );
      return {
        records: response.data.records ?? [],
        offset: response.data.offset,
      };
    } catch (error) {
      throw httpError("Airtable", "list records", error);
    }
  }

  /**
   * @description Fetches a single Airtable record
   * @summary `GET`s the table endpoint with the record ID appended and
   * returns the record envelope.
   * @param {string} table - The table name or ID.
   * @param {string} recordId - The record ID to fetch (e.g. `"rec1234567890"`).
   * @param {string} [baseId] - The base override; falls back to the configured `baseId`.
   * @returns {Promise<AirtableRecord>} The record envelope.
   * @throws {InternalError} When no token is configured or the table/base cannot be resolved.
   * @throws {NotFoundError} When the record does not exist (HTTP 404).
   * @throws {ConflictError} When Airtable answers with HTTP 409.
   * @throws {BadRequestError} When Airtable answers with any other HTTP error status.
   */
  async getRecord(
    table: string,
    recordId: string,
    baseId?: string
  ): Promise<AirtableRecord> {
    this.requireToken();
    try {
      const response = await this.client.get<AirtableRecord>(
        `${this.tablePath(table, baseId)}/${encodeURIComponent(recordId)}`
      );
      return response.data;
    } catch (error) {
      throw httpError("Airtable", "get record", error);
    }
  }

  /**
   * @description Creates an Airtable record
   * @summary `POST`s the fields map to the table endpoint; `typecast` lets
   * Airtable coerce values into the column types (disabled by default).
   * @param {AirtableWriteInput} input - The table, fields, and typecast option.
   * @param {string} [baseId] - The base override; falls back to the configured `baseId`.
   * @returns {Promise<AirtableRecord>} The created record envelope.
   * @throws {InternalError} When no token is configured or the table/base cannot be resolved.
   * @throws {NotFoundError} When the base or table does not exist (HTTP 404).
   * @throws {ConflictError} When Airtable answers with HTTP 409.
   * @throws {BadRequestError} When Airtable answers with any other HTTP error status (e.g. invalid field values).
   */
  async createRecord(
    input: AirtableWriteInput,
    baseId?: string
  ): Promise<AirtableRecord> {
    this.requireToken();
    try {
      const response = await this.client.post<AirtableRecord>(
        this.tablePath(input.table, baseId),
        { fields: input.fields, typecast: input.typecast ?? false }
      );
      return response.data;
    } catch (error) {
      throw httpError("Airtable", "create record", error);
    }
  }

  /**
   * @description Updates an Airtable record
   * @summary `PATCH`es the fields map onto the record identified by
   * `recordId`; only the provided fields change. `typecast` lets Airtable
   * coerce values into the column types (disabled by default).
   * @param {AirtableWriteInput & {recordId: string}} input - The table, fields, typecast option, and target record ID.
   * @param {string} [baseId] - The base override; falls back to the configured `baseId`.
   * @returns {Promise<AirtableRecord>} The updated record envelope.
   * @throws {InternalError} When no token is configured or the table/base cannot be resolved.
   * @throws {NotFoundError} When the record does not exist (HTTP 404).
   * @throws {ConflictError} When Airtable answers with HTTP 409.
   * @throws {BadRequestError} When Airtable answers with any other HTTP error status (e.g. invalid field values).
   */
  async updateRecord(
    input: AirtableWriteInput & { recordId: string },
    baseId?: string
  ): Promise<AirtableRecord> {
    this.requireToken();
    try {
      const response = await this.client.patch<AirtableRecord>(
        `${this.tablePath(input.table, baseId)}/${encodeURIComponent(
          input.recordId
        )}`,
        { fields: input.fields, typecast: input.typecast ?? false }
      );
      return response.data;
    } catch (error) {
      throw httpError("Airtable", "update record", error);
    }
  }

  /**
   * @description Deletes an Airtable record
   * @summary `DELETE`s the record identified by `recordId` and returns the
   * Airtable deletion confirmation.
   * @param {string} table - The table name or ID.
   * @param {string} recordId - The record ID to delete.
   * @param {string} [baseId] - The base override; falls back to the configured `baseId`.
   * @returns {Promise<{id: string, deleted: boolean}>} The deleted record's ID and Airtable's `deleted` confirmation.
   * @throws {InternalError} When no token is configured or the table/base cannot be resolved.
   * @throws {NotFoundError} When the record does not exist (HTTP 404).
   * @throws {ConflictError} When Airtable answers with HTTP 409.
   * @throws {BadRequestError} When Airtable answers with any other HTTP error status.
   */
  async deleteRecord(
    table: string,
    recordId: string,
    baseId?: string
  ): Promise<{ id: string; deleted: boolean }> {
    this.requireToken();
    try {
      const response = await this.client.delete<{
        id: string;
        deleted: boolean;
      }>(
        `${this.tablePath(table, baseId)}/${encodeURIComponent(recordId)}`
      );
      return response.data;
    } catch (error) {
      throw httpError("Airtable", "delete record", error);
    }
  }
}
