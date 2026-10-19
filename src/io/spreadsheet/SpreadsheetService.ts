import { InternalError } from "@decaf-ts/db-decorators";

/**
 * @module integrations/io/spreadsheet/service
 * @summary Delimiter-agnostic spreadsheet parsing and serialization service.
 * @description Parses and serializes CSV, TSV, and JSON tabular content
 * without external dependencies: a hand-written RFC 4180-style parser (quoted
 * fields, escaped quotes, CRLF handling) and a quoting serializer. Unlike the
 * other io services it is not HTTP-backed and requires no configuration — it
 * operates purely on in-memory strings and arrays.
 */

/**
 * @description The tabular content formats the spreadsheet service handles
 * @summary `"csv"` (comma-delimited), `"tsv"` (tab-delimited), and `"json"`
 * (an array of rows or of records keyed by column name).
 * @category IO
 * @memberOf module:integrations/io/spreadsheet/service
 */
export type SpreadsheetFormat = "csv" | "tsv" | "json";

/**
 * @description Options controlling how spreadsheet content is parsed
 * @summary Selects the `format` (inferred from the `delimiter` when omitted:
 * `"\t"` implies `"tsv"`, otherwise `"csv"`) and whether the first parsed row
 * is treated as a header (`true` by default; set `header: false` to keep it
 * in `rows` and receive an empty `header`).
 * @category IO
 * @memberOf module:integrations/io/spreadsheet/service
 */
export interface SpreadsheetParseOptions {
  /**
   * @description Explicit content format; inferred from `delimiter` when omitted
   */
  format?: SpreadsheetFormat;
  /**
   * @description Delimiter for delimited formats; defaults to `","` for CSV and `"\t"` for TSV
   */
  delimiter?: string;
  /**
   * @description Whether the first row is a header; defaults to `true`
   */
  header?: boolean;
}

/**
 * @description Result of parsing spreadsheet content
 * @summary Carries the resolved `format`, the `header` row (empty when
 * `header: false` was requested), and the remaining data `rows`.
 * @category IO
 * @memberOf module:integrations/io/spreadsheet/service
 */
export interface SpreadsheetParseResult {
  format: SpreadsheetFormat;
  header: string[];
  rows: string[][];
}

/**
 * @description Options controlling how rows are serialized to spreadsheet content
 * @summary Selects the `format` (inferred from the `delimiter` when omitted),
 * the `delimiter` for delimited formats, and an optional `header` row written
 * before the data. For `"json"`, the `header` values become the record keys
 * (falling back to the first data row as keys).
 * @category IO
 * @memberOf module:integrations/io/spreadsheet/service
 */
export interface SpreadsheetWriteOptions {
  /**
   * @description Explicit output format; inferred from `delimiter` when omitted
   */
  format?: SpreadsheetFormat;
  /**
   * @description Delimiter for delimited formats; defaults to `","` for CSV and `"\t"` for TSV
   */
  delimiter?: string;
  /**
   * @description Header row written before the data (or used as record keys for JSON)
   */
  header?: string[];
}

const DELIMITERS: Record<SpreadsheetFormat, string> = {
  csv: ",",
  tsv: "\t",
  json: "",
};

function resolveFormat(
  format: SpreadsheetFormat | undefined,
  delimiter: string | undefined
): SpreadsheetFormat {
  if (format) return format;
  if (delimiter === "\t") return "tsv";
  return "csv";
}

function parseDelimited(
  content: string,
  delimiter: string
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter(
    (entry) => entry.length > 1 || (entry[0] ?? "").trim().length > 0
  );
}

function quoteField(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * @description Dependency-free spreadsheet parsing and serialization service
 * @summary A stateless (no configuration, no HTTP client) service that
 * converts between tabular strings and row arrays. `parse` handles CSV and
 * TSV with a quoted-field parser (double-quote escaping, CRLF stripping,
 * blank-row filtering) and JSON arrays of rows or records; `serialize`
 * writes CSV/TSV with RFC 4180-style quoting of fields containing the
 * delimiter, quotes, or line breaks, or pretty-printed JSON records. Values
 * are stringified with `null`/`undefined` as empty cells and objects as JSON.
 * @class SpreadsheetService
 * @category IO
 * @example
 * ```ts
 * import { SpreadsheetService } from "@decaf-ts/integrations/io/spreadsheet";
 *
 * const spreadsheets = new SpreadsheetService();
 * const parsed = spreadsheets.parse("name,count\nalpha,1\nbeta,2", {
 *   format: "csv",
 * });
 * // parsed.header === ["name", "count"], parsed.rows === [["alpha", "1"], ["beta", "2"]]
 * ```
 * @memberOf module:integrations/io/spreadsheet/service
 */
export class SpreadsheetService {
  /**
   * @description Parses spreadsheet text into a header and data rows
   * @summary Dispatches on the resolved format. `"json"` content must be an
   * array: either an array of arrays (the first row becomes the header unless
   * `header: false`) or an array of records (the union of the first record's
   * keys becomes the header). CSV/TSV content is parsed with a quoted-field
   * parser honoring `""` escapes and CR/LF line endings, dropping blank rows;
   * the first row becomes the header unless `header: false`.
   * @param {string} content - The spreadsheet text content to parse.
   * @param {SpreadsheetParseOptions} [options] - Format, delimiter, and header options.
   * @returns {SpreadsheetParseResult} The resolved format, header row, and data rows.
   * @throws {InternalError} When the content is not a string, the JSON payload is invalid, or the JSON payload is not an array.
   * @example
   * ```ts
   * // TSV with an explicit delimiter and no header row
   * const tsv = spreadsheets.parse("alpha\t1\nbeta\t2", { delimiter: "\t", header: false });
   * // JSON records infer the header from the first record's keys
   * const json = spreadsheets.parse('[{"name":"alpha","count":1}]', { format: "json" });
   * ```
   */
  parse(
    content: string,
    options: SpreadsheetParseOptions = {}
  ): SpreadsheetParseResult {
    if (typeof content !== "string") {
      throw new InternalError("Spreadsheet parse requires text content");
    }
    const format = resolveFormat(options.format, options.delimiter);
    if (format === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        throw new InternalError(
          `Spreadsheet JSON parse failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (!Array.isArray(parsed)) {
        throw new InternalError(
          "Spreadsheet JSON content must be an array of rows or records"
        );
      }
      if (parsed.length === 0) return { format, header: [], rows: [] };
      if (Array.isArray(parsed[0])) {
        const rows = (parsed as unknown[][]).map((row) => row.map(cell));
        const header =
          options.header === false ? [] : (rows.shift() ?? []);
        return { format, header: header.map(cell), rows };
      }
      const records = parsed as Array<Record<string, unknown>>;
      const header = Object.keys(records[0] ?? {});
      const rows = records.map((record) =>
        header.map((field) => cell(record[field]))
      );
      return { format, header, rows };
    }
    const delimiter = options.delimiter ?? DELIMITERS[format];
    const rows = parseDelimited(content, delimiter);
    const header = options.header === false ? [] : (rows.shift() ?? []);
    return { format, header: header.map(cell), rows };
  }

  /**
   * @description Serializes rows into spreadsheet text
   * @summary Stringifies each cell (objects become JSON, `null`/`undefined`
   * become empty cells) and dispatches on the resolved format. For `"json"`,
   * the optional `header` values (or the first data row) become the record
   * keys and the output is pretty-printed JSON records. For `"csv"`/`"tsv"`,
   * fields containing the delimiter, quotes, or line breaks are wrapped in
   * double quotes with inner quotes escaped, and the optional `header` row is
   * written first. Non-array rows are treated as single-cell rows.
   * @param {unknown[][]} rows - The data rows to serialize.
   * @param {SpreadsheetWriteOptions} [options] - Format, delimiter, and header options.
   * @returns {string} The serialized spreadsheet content.
   * @throws {InternalError} When `rows` is not an array.
   * @example
   * ```ts
   * const csv = spreadsheets.serialize(
   *   [["alpha", 1], ["beta, gamma", 2]],
   *   { format: "csv", header: ["name", "count"] }
   * );
   * // "name,count\nalpha,1\n\"beta, gamma\",2"
   * ```
   */
  serialize(
    rows: unknown[][],
    options: SpreadsheetWriteOptions = {}
  ): string {
    if (!Array.isArray(rows)) {
      throw new InternalError(
        "Spreadsheet write requires rows as an array of arrays"
      );
    }
    const format = resolveFormat(options.format, options.delimiter);
    const header = options.header;
    const materialized = rows.map((row) =>
      Array.isArray(row) ? row.map(cell) : [cell(row)]
    );
    if (format === "json") {
      const fields = header ?? materialized.shift() ?? [];
      return JSON.stringify(
        materialized.map((row) =>
          Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ""]))
        ),
        null,
        2
      );
    }
    const delimiter = options.delimiter ?? DELIMITERS[format];
    const lines = [
      ...(header ? [header] : []),
      ...materialized,
    ].map((row) =>
      row.map((value) => quoteField(cell(value), delimiter)).join(delimiter)
    );
    return lines.join("\n");
  }
}
