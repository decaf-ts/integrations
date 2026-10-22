/**
 * @module integrations/io/google-sheets/service
 * @summary Google Sheets API integration service for reading and writing spreadsheet values.
 * @description Exposes the Google Sheets v4 values API (`get`, `update`,
 * `append`, `clear`) and spreadsheet creation as an undecorated
 * client-based service built on
 * {@link HttpApiService}. Authentication accepts either an OAuth token
 * (bearer) or a plain API key (`X-Goog-Api-Key`); configuration comes from an
 * explicit `GoogleSheetsServiceConfig` or the `io.googleSheets` environment
 * slice, and failures are mapped to decaf errors via {@link httpError}.
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
 * @description Configuration for the Google Sheets service
 * @summary Extends {@link HttpApiServiceConfig} with either an OAuth token
 * (preferred, sent as a bearer token) or an API key (sent as
 * `X-Goog-Api-Key`; read-only against public spreadsheets). When omitted, the
 * `io.googleSheets` environment slice supplies both (and optional
 * `baseUrl`/`timeout`).
 * @category IO
 * @memberOf module:integrations/io/google-sheets/service
 */
export interface GoogleSheetsServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Google OAuth access token
   * @summary Sent as `Authorization: Bearer <token>`; takes precedence over the API key.
   */
  token?: string;
  /**
   * @description Google API key
   * @summary Sent as `X-Goog-Api-Key` when no OAuth token is configured.
   */
  apiKey?: string;
}

/**
 * @description Result of a Google Sheets values read or write
 * @summary Echoes the target `spreadsheetId` and the A1 `range` Google
 * actually served, the `majorDimension` of the payload, and the grid
 * `values` as an array of rows (arrays of cell strings).
 * @category IO
 * @memberOf module:integrations/io/google-sheets/service
 */
export interface GoogleSheetsValuesResult {
  spreadsheetId: string;
  range: string;
  majorDimension?: string;
  values: string[][];
}

/**
 * @description Input for writing values into a Google Sheets range
 * @summary Carries the target `spreadsheetId` and A1 `range`, the row
 * `values` to write, and the `valueInputOption` controlling how Google
 * interprets the cells (`"RAW"` stores text as-is, `"USER_ENTERED"` applies
 * spreadsheet parsing and formulas; defaults to `"USER_ENTERED"`).
 * @category IO
 * @memberOf module:integrations/io/google-sheets/service
 */
export interface GoogleSheetsWriteInput {
  spreadsheetId: string;
  range: string;
  values: unknown[][];
  valueInputOption?: "RAW" | "USER_ENTERED";
}

/**
 * @description Google Sheets API integration service
 * @summary An undecorated HTTP service for reading,
 * updating, appending, and clearing values in A1 ranges of a spreadsheet, and
 * for creating new spreadsheets. Every operation requires either an OAuth
 * token or an API key (`requireAuth()`); ranges and spreadsheet IDs are
 * URL-encoded, and transport failures are mapped to decaf errors via
 * {@link httpError}.
 * @class GoogleSheetsService
 * @category IO
 * @example
 * ```ts
 * import { GoogleSheetsService } from "@decaf-ts/integrations/io/google-sheets";
 *
 * const sheets = new GoogleSheetsService();
 * await sheets.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_GOOGLE_SHEETS_TOKEN,
 * });
 * const created = await sheets.createSpreadsheet("Metrics");
 * await sheets.updateValues({
 *   spreadsheetId: created.spreadsheetId,
 *   range: "Sheet1!A1:B2",
 *   values: [
 *     ["date", "count"],
 *     ["2026-01-01", "42"],
 *   ],
 * });
 * ```
 * @memberOf module:integrations/io/google-sheets/service
 */
export class GoogleSheetsService extends HttpApiService<GoogleSheetsServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Google Sheets";

  /**
   * @description The Google Sheets v4 values API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://sheets.googleapis.com/v4/spreadsheets"`.
   */
  protected defaultBaseUrl(): string {
    return "https://sheets.googleapis.com/v4/spreadsheets";
  }

  /**
   * @description Builds the Google Sheets authorization headers
   * @summary Returns the `Authorization: Bearer <token>` header when the
   * config carries an OAuth token, otherwise the `X-Goog-Api-Key` header when
   * an API key is configured, and no headers otherwise.
   * @param {GoogleSheetsServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token or API key).
   */
  protected authHeaders(
    config: GoogleSheetsServiceConfig
  ): Record<string, string> {
    if (config.token) return { Authorization: `Bearer ${config.token}` };
    if (config.apiKey) return { "X-Goog-Api-Key": config.apiKey };
    return {};
  }

  /**
   * @description Reads the Google Sheets credentials and defaults from the environment
   * @summary Reads the `io.googleSheets` environment slice and returns a
   * partial config when a token or API key is configured, `undefined`
   * otherwise. Values pass through `envString`/`envNumber` to reject
   * unset-leaf proxies.
   * @returns {Partial<GoogleSheetsServiceConfig> | undefined} A partial config, or `undefined` when neither token nor API key is configured.
   */
  protected configFromEnvironment():
    | Partial<GoogleSheetsServiceConfig>
    | undefined {
    const env = IoEnvironment.io.googleSheets;
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
   * @description Asserts that the service was configured with OAuth credentials
   * @summary Throws when the resolved config carries neither a `token` nor an
   * `apiKey`; every operation calls this before issuing requests.
   * @returns {void}
   * @throws {InternalError} When neither an OAuth token nor an API key is configured.
   */
  protected requireAuth(): void {
    const config = this.config;
    if (!config.token && !config.apiKey) {
      throw new InternalError(
        "Google Sheets requires an OAuth token or an API key"
      );
    }
  }

  /**
   * @description URL-encodes an A1 range for the values API path
   * @summary Ranges such as `Sheet1!A1:B2` contain characters that must be
   * percent-encoded; all operations route the range through this helper.
   * @param {string} range - The A1 notation range to encode.
   * @returns {string} The URL-encoded range.
   */
  protected rangePath(range: string): string {
    return encodeURIComponent(range);
  }

  /**
   * @description Reads values from an A1 range of a spreadsheet
   * @summary `GET`s the values endpoint for the given `spreadsheetId` and
   * `range` and returns the served range, major dimension, and the grid
   * values (rows of cell strings). Requires credentials and both arguments.
   * @param {string} spreadsheetId - The spreadsheet to read from.
   * @param {string} range - The A1 notation range to read (e.g. `"Sheet1!A1:C10"`).
   * @returns {Promise<GoogleSheetsValuesResult>} The served range and grid values.
   * @throws {InternalError} When credentials are missing or the spreadsheet ID/range is empty.
   * @throws {NotFoundError} When the spreadsheet does not exist (HTTP 404).
   * @throws {ConflictError} When Google answers with HTTP 409.
   * @throws {BadRequestError} When Google answers with any other HTTP error status (e.g. invalid range).
   */
  async getValues(
    spreadsheetId: string,
    range: string
  ): Promise<GoogleSheetsValuesResult> {
    this.requireAuth();
    if (!spreadsheetId || !range) {
      throw new InternalError(
        "Google Sheets getValues requires a spreadsheet ID and range"
      );
    }
    try {
      const response = await this.client.get<GoogleSheetsValuesResult>(
        `/${encodeURIComponent(spreadsheetId)}/values/${this.rangePath(range)}`
      );
      return {
        spreadsheetId,
        range: response.data.range ?? range,
        majorDimension: response.data.majorDimension,
        values: response.data.values ?? [],
      };
    } catch (error) {
      throw httpError("Google Sheets", "get values", error);
    }
  }

  /**
   * @description Overwrites values in an A1 range of a spreadsheet
   * @summary `PUT`s the row values to the values endpoint for the given
   * `spreadsheetId` and `range`. Cells are interpreted according to
   * `valueInputOption` (`"USER_ENTERED"` by default, `"RAW"` to store text
   * verbatim), and the existing range content is replaced.
   * @param {GoogleSheetsWriteInput} input - The target spreadsheet, range, values, and input interpretation.
   * @returns {Promise<GoogleSheetsValuesResult>} The served range and the written values.
   * @throws {InternalError} When credentials are missing.
   * @throws {NotFoundError} When the spreadsheet does not exist (HTTP 404).
   * @throws {ConflictError} When Google answers with HTTP 409.
   * @throws {BadRequestError} When Google answers with any other HTTP error status (e.g. invalid range).
   */
  async updateValues(
    input: GoogleSheetsWriteInput
  ): Promise<GoogleSheetsValuesResult> {
    this.requireAuth();
    try {
      const response = await this.client.put<GoogleSheetsValuesResult>(
        `/${encodeURIComponent(input.spreadsheetId)}/values/${this.rangePath(
          input.range
        )}`,
        {
          range: input.range,
          majorDimension: "ROWS",
          values: input.values,
        },
        {
          params: {
            valueInputOption: input.valueInputOption ?? "USER_ENTERED",
          },
        }
      );
      return {
        spreadsheetId: input.spreadsheetId,
        range: response.data.range ?? input.range,
        majorDimension: response.data.majorDimension ?? "ROWS",
        values: response.data.values ?? input.values,
      };
    } catch (error) {
      throw httpError("Google Sheets", "update values", error);
    }
  }

  /**
   * @description Appends values after the last row of an A1 range's table
   * @summary `POST`s the row values to the `:append` endpoint for the given
   * `spreadsheetId` and `range`, inserting new rows after existing table data
   * (`insertDataOption: "INSERT_ROWS"`). Cells are interpreted according to
   * `valueInputOption` (`"USER_ENTERED"` by default). Use a single-row or
   * single-column A1 range to anchor the table; Google reports the range the
   * data actually landed in.
   * @param {GoogleSheetsWriteInput} input - The target spreadsheet, anchor range, values, and input interpretation.
   * @returns {Promise<GoogleSheetsValuesResult>} The range the appended rows landed in and the appended values.
   * @throws {InternalError} When credentials are missing.
   * @throws {NotFoundError} When the spreadsheet does not exist (HTTP 404).
   * @throws {ConflictError} When Google answers with HTTP 409.
   * @throws {BadRequestError} When Google answers with any other HTTP error status (e.g. invalid range).
   */
  async appendValues(
    input: GoogleSheetsWriteInput
  ): Promise<GoogleSheetsValuesResult> {
    this.requireAuth();
    try {
      const response = await this.client.post<GoogleSheetsValuesResult>(
        `/${encodeURIComponent(input.spreadsheetId)}/values/${this.rangePath(
          input.range
        )}:append`,
        {
          range: input.range,
          majorDimension: "ROWS",
          values: input.values,
        },
        {
          params: {
            valueInputOption: input.valueInputOption ?? "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
          },
        }
      );
      return {
        spreadsheetId: input.spreadsheetId,
        range: response.data.range ?? input.range,
        majorDimension: response.data.majorDimension ?? "ROWS",
        values: response.data.values ?? [],
      };
    } catch (error) {
      throw httpError("Google Sheets", "append values", error);
    }
  }

  /**
   * @description Clears all values in an A1 range of a spreadsheet
   * @summary `POST`s the `:clear` endpoint for the given `spreadsheetId` and
   * `range`, emptying the cells while preserving formatting, and returns the
   * range Google actually cleared.
   * @param {string} spreadsheetId - The spreadsheet to clear values in.
   * @param {string} range - The A1 notation range to clear.
   * @returns {Promise<{spreadsheetId: string, clearedRange: string}>} The cleared range as reported by Google.
   * @throws {InternalError} When credentials are missing.
   * @throws {NotFoundError} When the spreadsheet does not exist (HTTP 404).
   * @throws {ConflictError} When Google answers with HTTP 409.
   * @throws {BadRequestError} When Google answers with any other HTTP error status (e.g. invalid range).
   */
  async clearValues(
    spreadsheetId: string,
    range: string
  ): Promise<{ spreadsheetId: string; clearedRange: string }> {
    this.requireAuth();
    try {
      const response = await this.client.post<{ clearedRange?: string }>(
        `/${encodeURIComponent(spreadsheetId)}/values/${this.rangePath(
          range
        )}:clear`,
        {}
      );
      return {
        spreadsheetId,
        clearedRange: response.data.clearedRange ?? range,
      };
    } catch (error) {
      throw httpError("Google Sheets", "clear values", error);
    }
  }

  /**
   * @description Creates a new spreadsheet with the given title
   * @summary `POST`s a spreadsheet resource with `properties.title` to the
   * spreadsheets endpoint and returns the new spreadsheet's ID and URL.
   * @param {string} title - The title for the new spreadsheet.
   * @returns {Promise<{spreadsheetId: string, spreadsheetUrl?: string}>} The created spreadsheet's ID and URL.
   * @throws {InternalError} When credentials are missing or the title is empty.
   * @throws {NotFoundError} When Google answers with HTTP 404.
   * @throws {ConflictError} When Google answers with HTTP 409.
   * @throws {BadRequestError} When Google answers with any other HTTP error status.
   */
  async createSpreadsheet(
    title: string
  ): Promise<{ spreadsheetId: string; spreadsheetUrl?: string }> {
    this.requireAuth();
    if (!title) {
      throw new InternalError(
        "Google Sheets createSpreadsheet requires a title"
      );
    }
    try {
      const response = await this.client.post<{
        spreadsheetId: string;
        spreadsheetUrl?: string;
      }>("/", {
        properties: { title },
      });
      return {
        spreadsheetId: response.data.spreadsheetId,
        spreadsheetUrl: response.data.spreadsheetUrl,
      };
    } catch (error) {
      throw httpError("Google Sheets", "create spreadsheet", error);
    }
  }
}
