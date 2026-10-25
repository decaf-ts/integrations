/**
 * @module integrations/io/microsoft-excel/service
 * @summary Microsoft Excel workbook integration service (Microsoft Graph).
 * @description Exposes Graph workbook operations (worksheets, ranges, tables,
 * and table rows) as an undecorated client-based service built on
 * {@link HttpApiService}. Configuration comes from an explicit
 * `MicrosoftExcelServiceConfig` or the `io.microsoftExcel` environment slice;
 * the access token is sent as `Authorization: Bearer <token>`. Workbooks are
 * addressed by OneDrive/SharePoint `itemId`, optionally within a `driveId`.
 * Credentials are referenced from configuration (and, from as-graph nodes, from
 * the resolved `microsoft-excel` credential secret) and are never embedded in
 * source. Failures are mapped to decaf errors via {@link httpError}.
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
 * @description Configuration for the Microsoft Excel service
 * @summary Extends {@link HttpApiServiceConfig} with the Microsoft Graph
 * access token sent as a bearer token. When omitted, the
 * `io.microsoftExcel` environment slice supplies the token (plus optional
 * `baseUrl`/`timeout`).
 * @category IO
 * @memberOf module:integrations/io/microsoft-excel/service
 */
export interface MicrosoftExcelServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Microsoft Graph access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
}

/**
 * @description Reference to an Excel workbook
 * @summary Identifies a workbook by its drive item `itemId` and, optionally,
 * the `driveId` that owns it. Without `driveId` the signed-in user's drive is
 * used.
 * @category IO
 * @memberOf module:integrations/io/microsoft-excel/service
 */
export interface ExcelWorkbookRef {
  /**
   * @description Drive item ID of the workbook
   */
  itemId: string;
  /**
   * @description Drive ID owning the workbook (defaults to the user's drive)
   */
  driveId?: string;
}

/**
 * @description Reference to a worksheet range
 * @summary Carries the workbook reference plus the `worksheet` name and the
 * A1-style `range` address (e.g. `"A1:C10"`).
 * @category IO
 * @memberOf module:integrations/io/microsoft-excel/service
 */
export interface ExcelRangeInput extends ExcelWorkbookRef {
  /**
   * @description Worksheet name
   */
  worksheet: string;
  /**
   * @description A1-style range address
   */
  range: string;
}

/**
 * @description Input for writing values to a worksheet range
 * @summary Carries the range reference plus the two-dimensional `values`
 * matrix written to it.
 * @category IO
 * @memberOf module:integrations/io/microsoft-excel/service
 */
export interface ExcelRangeWriteInput extends ExcelRangeInput {
  /**
   * @description Row-major matrix of values to write
   */
  values: unknown[][];
}

/**
 * @description Input for appending a row to an Excel table
 * @summary Carries the workbook reference, the `tableId`, and the row
 * `values` in table-column order.
 * @category IO
 * @memberOf module:integrations/io/microsoft-excel/service
 */
export interface ExcelTableRowInput extends ExcelWorkbookRef {
  /**
   * @description Table ID within the workbook
   */
  tableId: string;
  /**
   * @description Row values in table-column order
   */
  values: unknown[];
}

/**
 * @description Microsoft Excel (Graph) workbook integration service
 * @summary An undecorated HTTP service for listing worksheets and tables,
 * reading and writing ranges, and appending table rows. Every operation
 * requires a Graph access token and a workbook `itemId`; missing credentials or
 * identifiers raise `InternalError`, and transport failures are mapped to decaf
 * errors via {@link httpError}.
 * @class MicrosoftExcelService
 * @extends HttpApiService
 * @category IO
 * @example
 * ```ts
 * import { MicrosoftExcelService } from "@decaf-ts/integrations/io/microsoft-excel";
 *
 * const excel = new MicrosoftExcelService();
 * await excel.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_MICROSOFT_EXCEL_TOKEN,
 * });
 * const range = await excel.getRange({
 *   itemId: process.env.EXCEL_ITEM_ID ?? "",
 *   worksheet: "Sheet1",
 *   range: "A1:C10",
 * });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as MicrosoftExcelService
 *   participant Graph as Microsoft Graph
 *   Caller->>Service: updateRange(input)
 *   activate Service
 *   Service->>Service: requireAccessToken()
 *   Service->>Graph: PATCH /me/drive/items/{id}/workbook/worksheets/{name}/range(...)
 *   activate Graph
 *   Graph-->>Service: updated range payload
 *   deactivate Graph
 *   Service-->>Caller: updated range payload
 *   deactivate Service
 * @memberOf module:integrations/io/microsoft-excel/service
 */
export class MicrosoftExcelService extends HttpApiService<MicrosoftExcelServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Microsoft Excel";

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
   * @param {MicrosoftExcelServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(
    config: MicrosoftExcelServiceConfig
  ): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the Excel credentials and defaults from the environment
   * @summary Reads the `io.microsoftExcel` slice and returns a partial config
   * when an access token is configured, `undefined` otherwise. Values pass
   * through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<MicrosoftExcelServiceConfig> | undefined} A partial config, or `undefined` when no Excel token is configured.
   */
  protected configFromEnvironment():
    | Partial<MicrosoftExcelServiceConfig>
    | undefined {
    const env = IoEnvironment.io.microsoftExcel;
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
   * @description Builds the Graph workbook path for a drive item
   * @summary Uses `/drives/<driveId>/items/<itemId>/workbook` when a `driveId`
   * is set, otherwise the signed-in user's `/me/drive/...` path.
   * @param {ExcelWorkbookRef} input - The workbook reference.
   * @returns {string} The workbook API path.
   * @throws {InternalError} When `itemId` is empty.
   */
  private workbookPath(input: ExcelWorkbookRef): string {
    if (!input.itemId) {
      throw new InternalError("Microsoft Excel requires a workbook item id");
    }
    const item = encodeURIComponent(input.itemId);
    return input.driveId
      ? `/drives/${encodeURIComponent(input.driveId)}/items/${item}/workbook`
      : `/me/drive/items/${item}/workbook`;
  }

  /**
   * @description Builds the Graph worksheet range path
   * @summary Appends the encoded worksheet and A1 `range(address=...)`
   * segments to the workbook path.
   * @param {ExcelRangeInput} input - The workbook, worksheet, and range.
   * @returns {string} The worksheet range API path.
   * @throws {InternalError} When the worksheet or range is empty.
   */
  private rangePath(input: ExcelRangeInput): string {
    if (!input.worksheet || !input.range) {
      throw new InternalError(
        "Microsoft Excel requires a worksheet and range"
      );
    }
    return `${this.workbookPath(input)}/worksheets/${encodeURIComponent(
      input.worksheet
    )}/range(address='${encodeURIComponent(input.range)}')`;
  }

  /**
   * @description Lists the worksheets in a workbook
   * @summary `GET`s the workbook's `/worksheets` collection.
   * @param {ExcelWorkbookRef} input - The workbook reference.
   * @returns {Promise<unknown>} The Graph worksheet collection.
   * @throws {InternalError} When no token is configured or `itemId` is empty.
   * @throws {NotFoundError} When the workbook does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async listWorksheets(input: ExcelWorkbookRef): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get(
        `${this.workbookPath(input)}/worksheets`
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Excel", "list worksheets", error);
    }
  }

  /**
   * @description Reads values from a worksheet range
   * @summary `GET`s the addressed range and returns its values and formatting
   * payload.
   * @param {ExcelRangeInput} input - The workbook, worksheet, and range.
   * @returns {Promise<unknown>} The range payload.
   * @throws {InternalError} When no token is configured, or the workbook, worksheet, or range is empty.
   * @throws {NotFoundError} When the workbook or range does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async getRange(input: ExcelRangeInput): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get(this.rangePath(input));
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Excel", "get range", error);
    }
  }

  /**
   * @description Writes values into a worksheet range
   * @summary `PATCH`es the addressed range with the supplied `values` matrix
   * and returns the updated range payload.
   * @param {ExcelRangeWriteInput} input - The range reference and values to write.
   * @returns {Promise<unknown>} The updated range payload.
   * @throws {InternalError} When no token is configured, or the workbook, worksheet, or range is empty.
   * @throws {NotFoundError} When the workbook or range does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async updateRange(input: ExcelRangeWriteInput): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.patch(this.rangePath(input), {
        values: input.values,
      });
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Excel", "update range", error);
    }
  }

  /**
   * @description Lists the tables in a workbook
   * @summary `GET`s the workbook's `/tables` collection.
   * @param {ExcelWorkbookRef} input - The workbook reference.
   * @returns {Promise<unknown>} The Graph table collection.
   * @throws {InternalError} When no token is configured or `itemId` is empty.
   * @throws {NotFoundError} When the workbook does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async listTables(input: ExcelWorkbookRef): Promise<unknown> {
    this.requireAccessToken();
    try {
      const response = await this.client.get(
        `${this.workbookPath(input)}/tables`
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Excel", "list tables", error);
    }
  }

  /**
   * @description Appends a row to an Excel table
   * @summary `POST`s the single row to the table's `/rows/add` endpoint and
   * returns the Graph row payload.
   * @param {ExcelTableRowInput} input - The workbook, table, and row values.
   * @returns {Promise<unknown>} The created table row payload.
   * @throws {InternalError} When no token is configured, or the workbook, table, or values are missing.
   * @throws {NotFoundError} When the workbook or table does not exist (HTTP 404).
   * @throws {BadRequestError} When Graph rejects the request.
   */
  async addTableRow(input: ExcelTableRowInput): Promise<unknown> {
    this.requireAccessToken();
    if (!input.tableId || !input.values?.length) {
      throw new InternalError(
        "Microsoft Excel addTableRow requires a table id and values"
      );
    }
    try {
      const response = await this.client.post(
        `${this.workbookPath(input)}/tables/${encodeURIComponent(
          input.tableId
        )}/rows/add`,
        { values: [input.values] }
      );
      return response.data;
    } catch (error) {
      throw httpError("Microsoft Excel", "add table row", error);
    }
  }
}
