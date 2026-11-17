import { Condition, ModelService, service } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import { ERPNextReport } from "../models/ERPNextReport.model";
import type { ERPNextRepository } from "../ERPNextRepository";

/**
 * @description A column descriptor returned by a Frappe report
 * @summary Mirrors the Frappe query report column shape; extra keys are preserved.
 * @interface ERPNextReportColumn
 * @property {string} [fieldname] Column field name
 * @property {string} [label] Column label
 * @property {string} [fieldtype] Column field type
 * @property {string} [options] Field options
 * @property {number} [width] Column width
 * @memberOf module:erpnext
 */
export interface ERPNextReportColumn {
  fieldname?: string;
  label?: string;
  fieldtype?: string;
  options?: string;
  width?: number;
  [key: string]: unknown;
}

/**
 * @description The result of running a Frappe report
 * @summary Contains the report columns, rows and optional message, chart and summary.
 * @interface ERPNextReportRunResult
 * @property {ERPNextReportColumn[]} columns Report columns
 * @property {unknown[]} result Report rows
 * @property {string} [message] Report message
 * @property {unknown} [chart] Chart data
 * @property {unknown[]} [report_summary] Report summary entries
 * @property {boolean} [skip_total_row] Whether the total row is skipped
 * @memberOf module:erpnext
 */
export interface ERPNextReportRunResult {
  columns: ERPNextReportColumn[];
  result: unknown[];
  message?: string;
  chart?: unknown;
  report_summary?: unknown[];
  skip_total_row?: boolean;
}

/**
 * @description Options accepted when running a report
 * @summary Passed through to the `frappe.desk.query_report.run` method.
 * @interface ERPNextReportRunOptions
 * @property {Record<string, unknown>} [filters] Report filters
 * @property {boolean} [ignorePreparedReport] Ignore a prepared report
 * @property {boolean} [areDefaultFilters] Whether the filters are the defaults
 * @memberOf module:erpnext
 */
export interface ERPNextReportRunOptions {
  filters?: Record<string, unknown>;
  ignorePreparedReport?: boolean;
  areDefaultFilters?: boolean;
}

/**
 * @description Service for running Frappe reports
 * @summary Runs builder, query and script reports through the Frappe
 * `frappe.desk.query_report.run` method and lists the reports available for a
 * doctype.
 * @class ERPNextReportService
 * @category ERPNext
 * @example
 * ```typescript
 * const result = await service(ERPNextReportService).run("Accounts Receivable");
 * ```
 */
@service(ERPNextReport)
export class ERPNextReportService extends ModelService<ERPNextReport> {
  constructor() {
    super(ERPNextReport);
  }

  /**
   * @description Runs a Frappe report
   * @summary Calls `frappe.desk.query_report.run` with the supplied filters and
   * normalizes the response into columns and rows.
   * @param {ERPNextReport|string} report - The report model or report name
   * @param {ERPNextReportRunOptions} [options] - Run options
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextReportRunResult>} The normalized report result
   */
  async run(
    report: ERPNextReport | string,
    options: ERPNextReportRunOptions = {},
    ...args: any[]
  ): Promise<ERPNextReportRunResult> {
    void args;
    const name =
      typeof report === "string"
        ? report
        : (report.name ?? report.report_name);
    if (!name)
      throw new ValidationError("A report name is required to run a report");

    const repo = this.repo as unknown as ERPNextRepository<ERPNextReport>;
    const response = await repo.client.callMethod(
      "frappe.desk.query_report.run",
      {
        report_name: name,
        filters: options.filters ?? {},
        ignore_prepared_report: options.ignorePreparedReport ?? false,
        are_default_filters: options.areDefaultFilters ?? false,
      }
    );

    const payload =
      response && typeof response === "object" && "message" in response
        ? (response as { message: Record<string, any> }).message
        : (response ?? {});

    return {
      columns: (payload.columns ?? []) as ERPNextReportColumn[],
      result: (payload.result ?? []) as unknown[],
      message: payload.message,
      chart: payload.chart,
      report_summary: payload.report_summary,
      skip_total_row: payload.skip_total_row,
    };
  }

  /**
   * @description Runs a Frappe report by name
   * @param {string} name - The report name
   * @param {ERPNextReportRunOptions} [options] - Run options
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextReportRunResult>} The normalized report result
   */
  async runByName(
    name: string,
    options: ERPNextReportRunOptions = {},
    ...args: any[]
  ): Promise<ERPNextReportRunResult> {
    return this.run(name, options, ...args);
  }

  /**
   * @description Lists reports attached to a doctype
   * @summary Filters the reports whose `ref_doctype` matches the supplied doctype.
   * @param {string} refDoctype - The referenced doctype
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextReport[]>} The matching reports
   */
  async listForDoctype(
    refDoctype: string,
    ...args: any[]
  ): Promise<ERPNextReport[]> {
    return this.repo
      .select()
      .where(Condition.attr<ERPNextReport>("ref_doctype").eq(refDoctype))
      .execute(...args);
  }
}
