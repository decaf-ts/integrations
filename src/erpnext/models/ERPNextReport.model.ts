import { column, index, pk, table } from "@decaf-ts/core";
import { description, uses } from "@decaf-ts/decoration";
import {
  Model,
  type ModelArg,
  list,
  min,
  model,
  option,
  required,
  type as typeOf,
} from "@decaf-ts/decorator-validation";
import {
  uielement,
  uilistmodel,
  uilistprop,
  uimodel,
} from "@decaf-ts/ui-decorators";
import { ERPNextFlavour } from "../constants";
import { ERPNextYesNoOptions } from "./ERPNextPayment.model";

/**
 * @description Allowed Frappe report doctype types
 * @summary Mirrors the Frappe `Report.report_type` select options.
 * @const ERPNextReportDoctypeTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextReportDoctypeTypeOptions = [
  "Report Builder",
  "Query Report",
  "Script Report",
  "Custom Report",
] as const;

/**
 * @description Frappe `Report` doctype as a decaf model
 * @summary Report definition consumed by {@link ERPNextReportService} to run
 * builder, query and script reports.
 * @class ERPNextReport
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("Frappe Report doctype")
@table("Report")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-bar-chart" })
@model()
export class ERPNextReport extends Model {
  constructor(data?: ModelArg<ERPNextReport>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.name.label",
    placeholder: "erpnext.report.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Report name")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.reportName.label",
  })
  @uilistprop("description")
  report_name!: string;

  @description("Doctype the report reads")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.refDoctype.label",
  })
  ref_doctype!: string;

  @description("Reference report")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.referenceReport.label",
  })
  reference_report?: string;

  @description("Whether the report is a standard report")
  @required()
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.isStandard.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  is_standard!: string;

  @description("Module that owns the report")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.module.label",
  })
  module?: string;

  @description("Report type")
  @required()
  @option([...ERPNextReportDoctypeTypeOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.reportType.label",
    type: "select",
    options: ERPNextReportDoctypeTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  report_type!: string;

  @description("Letter head used when printing")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.letterHead.label",
  })
  letter_head?: string;

  @description("Add a total row to the report")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.addTotalRow.label",
    type: "checkbox",
  })
  add_total_row?: boolean;

  @description("Whether the report is disabled")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.disabled.label",
    type: "checkbox",
  })
  disabled?: boolean;

  @description("Whether the report is a prepared report")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.preparedReport.label",
    type: "checkbox",
  })
  prepared_report?: boolean;

  @description("Whether the report is a snapshot report")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.snapshotReport.label",
    type: "checkbox",
  })
  snapshot_report?: boolean;

  @description("Disable prepared report automation")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.disablePreparedReportAutomation.label",
    type: "checkbox",
  })
  disable_prepared_report_automation?: boolean;

  @description("Add translation data to the report")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.addTranslateData.label",
    type: "checkbox",
  })
  add_translate_data?: boolean;

  @description("Report execution timeout in seconds")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.timeout.label",
    type: "number",
  })
  timeout?: number;

  @description("Query report SQL")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.query.label",
  })
  query?: string;

  @description("Script report Python source")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.reportScript.label",
  })
  report_script?: string;

  @description("Report JavaScript")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.javascript.label",
  })
  javascript?: string;

  @description("Report JSON definition")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.json.label",
  })
  json?: string;

  @description("Report filters")
  @column()
  @list(() => Object)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.filters.label",
  })
  filters?: Record<string, unknown>[];

  @description("Report columns")
  @column()
  @list(() => Object)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.columns.label",
  })
  columns?: Record<string, unknown>[];

  @description("Roles allowed to run the report")
  @column()
  @list(() => Object)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.roles.label",
  })
  roles?: Record<string, unknown>[];

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.report.modified.label",
    type: "datetime-local",
  })
  modified?: Date;

  @description("Frappe owner user")
  @column()
  owner?: string;

  @description("Frappe last modifying user")
  @column("modified_by")
  modified_by?: string;
}
