import { column, index, pk, table } from "@decaf-ts/core";
import { description, uses } from "@decaf-ts/decoration";
import {
  Model,
  type ModelArg,
  list,
  min,
  model,
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

/**
 * @description ERPNext `Sales Invoice Item` child table row
 * @summary Child-table row used by {@link ERPNextSalesInvoice}. ERPNext serializes
 * child tables as plain arrays, so this class is decorated as a model to carry the
 * validation and form metadata used by the for-angular CRUD form.
 * @class ERPNextSalesInvoiceItem
 * @category ERPNext
 */
@description("ERPNext Sales Invoice Item child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextSalesInvoiceItem extends Model {
  constructor(data?: ModelArg<ERPNextSalesInvoiceItem>) {
    super(data);
  }

  @description("Item code linked to the Item doctype")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoiceItem.itemCode.label",
  })
  item_code!: string;

  @description("Item display name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoiceItem.itemName.label",
  })
  item_name?: string;

  @description("Quantity sold")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoiceItem.qty.label",
    type: "number",
  })
  qty?: number;

  @description("Unit rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoiceItem.rate.label",
    type: "number",
  })
  rate?: number;

  @description("Line amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoiceItem.amount.label",
    type: "number",
  })
  amount?: number;

  @description("Unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoiceItem.uom.label",
  })
  uom?: string;
}

/**
 * @description ERPNext `Sales Invoice` doctype as a decaf model
 * @summary Seed model for the ERPNext adapter. The primary key is the Frappe
 * document `name`; link, date, amount and status fields map to the identically
 * named Sales Invoice fields. It is decorated for validation and for the default
 * for-angular CRUD form and list item components.
 * @class ERPNextSalesInvoice
 * @category ERPNext
 * @example
 * ```typescript
 * const invoice = new ERPNextSalesInvoice({
 *   customer: "ACME Ltd",
 *   company: "ACME",
 *   posting_date: new Date(),
 * });
 * await Repository.forModel(ERPNextSalesInvoice).create(invoice);
 * ```
 */
@uses(ERPNextFlavour)
@description("ERPNext Sales Invoice doctype")
@table("Sales Invoice")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-receipt" })
@model()
export class ERPNextSalesInvoice extends Model {
  constructor(data?: ModelArg<ERPNextSalesInvoice>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.name.label",
    placeholder: "erpnext.salesInvoice.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Customer linked to the invoice")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.customer.label",
  })
  @uilistprop("description")
  customer!: string;

  @description("Company issuing the invoice")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.company.label",
  })
  company!: string;

  @description("Invoice posting date")
  @required()
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.postingDate.label",
    type: "date",
  })
  posting_date!: Date;

  @description("Invoice due date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.dueDate.label",
    type: "date",
  })
  due_date?: Date;

  @description("Billing currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.currency.label",
  })
  currency?: string;

  @description("Invoice total")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.grandTotal.label",
    type: "number",
  })
  grand_total?: number;

  @description("Outstanding amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.outstandingAmount.label",
    type: "number",
  })
  outstanding_amount?: number;

  @description("Frappe workflow status")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.status.label",
  })
  status?: string;

  @description("Frappe document status (0 draft, 1 submitted, 2 cancelled)")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.docstatus.label",
    type: "number",
  })
  docstatus?: number;

  @description("Whether the invoice is a return")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.isReturn.label",
    type: "checkbox",
  })
  is_return?: boolean;

  @description("Invoice line items")
  @column()
  @list(() => ERPNextSalesInvoiceItem)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.items.label",
    options: () => ERPNextSalesInvoiceItem,
  })
  items?: ERPNextSalesInvoiceItem[];

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.salesInvoice.modified.label",
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
