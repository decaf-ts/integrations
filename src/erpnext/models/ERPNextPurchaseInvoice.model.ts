import { column, index, pk, table } from "@decaf-ts/core";
import { description, uses } from "@decaf-ts/decoration";
import {
  Model,
  type ModelArg,
  list,
  max,
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
import { ERPNextMarginTypeOptions } from "./ERPNextPromotion.model";

/**
 * @description Allowed purchase invoice statuses
 * @summary Mirrors the Frappe `Purchase Invoice.status` select options.
 * @const ERPNextPurchaseInvoiceStatusOptions
 * @memberOf module:erpnext
 */
export const ERPNextPurchaseInvoiceStatusOptions = [
  "Draft",
  "Return",
  "Debit Note Issued",
  "Submitted",
  "Paid",
  "Partly Paid",
  "Unpaid",
  "Overdue",
  "Cancelled",
  "Internal Transfer",
] as const;

/**
 * @description ERPNext `Purchase Invoice Item` child doctype as a decaf model
 * @summary Line item of a purchase invoice with quantity, rate, discount and tax
 * fields.
 * @class ERPNextPurchaseInvoiceItem
 * @category ERPNext
 */
@description("ERPNext Purchase Invoice Item child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPurchaseInvoiceItem extends Model {
  constructor(data?: ModelArg<ERPNextPurchaseInvoiceItem>) {
    super(data);
  }

  @description("Item code linked to the Item doctype")
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.itemCode.label",
  })
  item_code?: string;

  @description("Item display name")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.itemName.label",
  })
  item_name!: string;

  @description("Item description")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.description.label",
  })
  description?: string;

  @description("Item brand")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.brand.label",
  })
  brand?: string;

  @description("Item group")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.itemGroup.label",
  })
  item_group?: string;

  @description("Quantity received")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.receivedQty.label",
    type: "number",
  })
  received_qty?: number;

  @description("Quantity purchased")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.qty.label",
    type: "number",
  })
  qty!: number;

  @description("Quantity rejected")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.rejectedQty.label",
    type: "number",
  })
  rejected_qty?: number;

  @description("Unit of measure")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.uom.label",
  })
  uom!: string;

  @description("Conversion factor to the stock unit")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.conversionFactor.label",
    type: "number",
  })
  conversion_factor!: number;

  @description("Stock unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.stockUom.label",
  })
  stock_uom?: string;

  @description("Quantity in stock units")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.stockQty.label",
    type: "number",
  })
  stock_qty!: number;

  @description("Price list rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.priceListRate.label",
    type: "number",
  })
  price_list_rate?: number;

  @description("Base price list rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.basePriceListRate.label",
    type: "number",
  })
  base_price_list_rate?: number;

  @description("Margin type")
  @option([...ERPNextMarginTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.marginType.label",
    type: "select",
    options: ERPNextMarginTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  margin_type?: string;

  @description("Margin rate or amount")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.marginRateOrAmount.label",
    type: "number",
  })
  margin_rate_or_amount?: number;

  @description("Rate with margin")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.rateWithMargin.label",
    type: "number",
  })
  rate_with_margin?: number;

  @description("Discount percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.discountPercentage.label",
    type: "number",
  })
  discount_percentage?: number;

  @description("Discount amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.discountAmount.label",
    type: "number",
  })
  discount_amount?: number;

  @description("Unit rate")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.rate.label",
    type: "number",
  })
  rate!: number;

  @description("Line amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.amount.label",
    type: "number",
  })
  amount!: number;

  @description("Line base rate")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.baseRate.label",
    type: "number",
  })
  base_rate!: number;

  @description("Line base amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.baseAmount.label",
    type: "number",
  })
  base_amount!: number;

  @description("Item tax template")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.itemTaxTemplate.label",
  })
  item_tax_template?: string;

  @description("Net rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.netRate.label",
    type: "number",
  })
  net_rate?: number;

  @description("Net amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.netAmount.label",
    type: "number",
  })
  net_amount?: number;

  @description("Whether the item is a free item")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.isFreeItem.label",
    type: "checkbox",
  })
  is_free_item?: boolean;

  @description("Warehouse receiving the item")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoiceItem.warehouse.label",
  })
  warehouse?: string;
}

/**
 * @description ERPNext `Purchase Invoice` doctype as a decaf model
 * @summary Supplier invoice with its line items, taxes and payment schedule.
 * @class ERPNextPurchaseInvoice
 * @category ERPNext
 * @example
 * ```typescript
 * const invoice = new ERPNextPurchaseInvoice({ supplier: "ACME" });
 * await Repository.forModel(ERPNextPurchaseInvoice).create(invoice);
 * ```
 */
@uses(ERPNextFlavour)
@description("ERPNext Purchase Invoice doctype")
@table("Purchase Invoice")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-file" })
@model()
export class ERPNextPurchaseInvoice extends Model {
  constructor(data?: ModelArg<ERPNextPurchaseInvoice>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.name.label",
    placeholder: "erpnext.purchaseInvoice.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Invoice title")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.title.label",
  })
  title?: string;

  @description("Supplier issuing the invoice")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.supplier.label",
  })
  @uilistprop("description")
  supplier!: string;

  @description("Supplier display name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.supplierName.label",
  })
  supplier_name?: string;

  @description("Supplier tax identifier")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.taxId.label",
  })
  tax_id?: string;

  @description("Company receiving the invoice")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.company.label",
  })
  company?: string;

  @description("Invoice posting date")
  @required()
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.postingDate.label",
    type: "date",
  })
  posting_date!: Date;

  @description("Invoice posting time")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.postingTime.label",
    type: "time",
  })
  posting_time?: string;

  @description("Set the posting time manually")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.setPostingTime.label",
    type: "checkbox",
  })
  set_posting_time?: boolean;

  @description("Invoice due date")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.dueDate.label",
    type: "date",
  })
  due_date?: Date;

  @description("Whether the invoice is fully paid")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.isPaid.label",
    type: "checkbox",
  })
  is_paid?: boolean;

  @description("Whether the invoice is a return")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.isReturn.label",
    type: "checkbox",
  })
  is_return?: boolean;

  @description("Invoice this return is against")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.returnAgainst.label",
  })
  return_against?: string;

  @description("Supplier bill number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.billNo.label",
  })
  bill_no?: string;

  @description("Supplier bill date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.billDate.label",
    type: "date",
  })
  bill_date?: Date;

  @description("Cost center allocated to the invoice")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.costCenter.label",
  })
  cost_center?: string;

  @description("Project allocated to the invoice")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.project.label",
  })
  project?: string;

  @description("Invoice currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.currency.label",
  })
  currency?: string;

  @description("Currency conversion rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.conversionRate.label",
    type: "number",
  })
  conversion_rate?: number;

  @description("Use the transaction date exchange rate")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.useTransactionDateExchangeRate.label",
    type: "checkbox",
  })
  use_transaction_date_exchange_rate?: boolean;

  @description("Buying price list")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.buyingPriceList.label",
  })
  buying_price_list?: string;

  @description("Price list currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.priceListCurrency.label",
  })
  price_list_currency?: string;

  @description("Price list conversion rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.plcConversionRate.label",
    type: "number",
  })
  plc_conversion_rate?: number;

  @description("Ignore pricing rules")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.ignorePricingRule.label",
    type: "checkbox",
  })
  ignore_pricing_rule?: boolean;

  @description("Update stock on submission")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.updateStock.label",
    type: "checkbox",
  })
  update_stock?: boolean;

  @description("Default receiving warehouse")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.setWarehouse.label",
  })
  set_warehouse?: string;

  @description("Source warehouse")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.setFromWarehouse.label",
  })
  set_from_warehouse?: string;

  @description("Whether the invoice is subcontracted")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.isSubcontracted.label",
    type: "checkbox",
  })
  is_subcontracted?: boolean;

  @description("Invoice line items")
  @required()
  @column()
  @list(() => ERPNextPurchaseInvoiceItem)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.items.label",
    options: () => ERPNextPurchaseInvoiceItem,
  })
  items!: ERPNextPurchaseInvoiceItem[];

  @description("Total quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.totalQty.label",
    type: "number",
  })
  total_qty?: number;

  @description("Total amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.total.label",
    type: "number",
  })
  total?: number;

  @description("Net total")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.netTotal.label",
    type: "number",
  })
  net_total?: number;

  @description("Taxes and charges template")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.taxesAndCharges.label",
  })
  taxes_and_charges?: string;

  @description("Grand total")
  @min(0)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.grandTotal.label",
    type: "number",
  })
  grand_total?: number;

  @description("Rounding adjustment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.roundingAdjustment.label",
    type: "number",
  })
  rounding_adjustment?: number;

  @description("Rounded total")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.roundedTotal.label",
    type: "number",
  })
  rounded_total?: number;

  @description("Outstanding amount")
  @min(0)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.outstandingAmount.label",
    type: "number",
  })
  outstanding_amount?: number;

  @description("Additional discount percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.additionalDiscountPercentage.label",
    type: "number",
  })
  additional_discount_percentage?: number;

  @description("Additional discount amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.discountAmount.label",
    type: "number",
  })
  discount_amount?: number;

  @description("Invoice status")
  @option([...ERPNextPurchaseInvoiceStatusOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.status.label",
    type: "select",
    options: ERPNextPurchaseInvoiceStatusOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  status?: string;

  @description("Frappe document status (0 draft, 1 submitted, 2 cancelled)")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.docstatus.label",
    type: "number",
  })
  docstatus?: number;

  @description("Invoice remarks")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.remarks.label",
  })
  remarks?: string;

  @description("Original invoice this one amends")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.amendedFrom.label",
  })
  amended_from?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.purchaseInvoice.modified.label",
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
