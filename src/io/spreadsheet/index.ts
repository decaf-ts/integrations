/**
 * @module integrations/io/spreadsheet
 * @summary Tabular text parse/serialize service (CSV, TSV, JSON lines) and
 * the binary workbook reader/writer (XLSX, ODS, XLS).
 * @description Re-exports the offline spreadsheet and workbook services and
 * their types; no network or credentials are involved.
 */
export * from "./SpreadsheetService";
export * from "./WorkbookService";
