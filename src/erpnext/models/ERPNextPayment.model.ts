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

/**
 * @description Allowed ERPNext payment types
 * @summary Mirrors the Frappe `Payment Entry.payment_type` select options.
 * @const ERPNextPaymentTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextPaymentTypeOptions = [
  "Receive",
  "Pay",
  "Internal Transfer",
] as const;

/**
 * @description Allowed payment order statuses
 * @summary Mirrors the Frappe `Payment Order.status` select options.
 * @const ERPNextPaymentOrderStatusOptions
 * @memberOf module:erpnext
 */
export const ERPNextPaymentOrderStatusOptions = [
  "Initiated",
  "Payment Ordered",
] as const;

/**
 * @description Allowed payment entry document statuses
 * @summary Mirrors the Frappe `Payment Entry.docstatus` states used by the adapter.
 * @const ERPNextPaymentEntryStatusOptions
 * @memberOf module:erpnext
 */
export const ERPNextPaymentEntryStatusOptions = [
  "Draft",
  "Submitted",
  "Cancelled",
] as const;

/**
 * @description Generic Frappe yes/no select options
 * @summary Shared by check-like doctype fields that store `"Yes"`/`"No"` strings.
 * @const ERPNextYesNoOptions
 * @memberOf module:erpnext
 */
export const ERPNextYesNoOptions = ["No", "Yes"] as const;

/**
 * @description Allowed payment request directions
 * @summary Mirrors the Frappe `Payment Request.payment_request_type` options.
 * @const ERPNextPaymentRequestTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextPaymentRequestTypeOptions = [
  "Outward",
  "Inward",
] as const;

/**
 * @description Allowed payment request statuses
 * @summary Mirrors the Frappe `Payment Request.status` select options.
 * @const ERPNextPaymentRequestStatusOptions
 * @memberOf module:erpnext
 */
export const ERPNextPaymentRequestStatusOptions = [
  "Draft",
  "Requested",
  "Initiated",
  "Partially Paid",
  "Payment Ordered",
  "Paid",
  "Failed",
  "Cancelled",
] as const;

/**
 * @description Allowed payment request delivery channels
 * @summary Mirrors the Frappe `Payment Request.payment_channel` options.
 * @const ERPNextPaymentChannelOptions
 * @memberOf module:erpnext
 */
export const ERPNextPaymentChannelOptions = ["Email", "Phone"] as const;

/**
 * @description ERPNext `Payment Entry Reference` child doctype as a decaf model
 * @summary Child row linking a Payment Entry to the invoice or order it settles,
 * carrying allocated and outstanding amounts.
 * @class ERPNextPaymentEntryReference
 * @category ERPNext
 */
@description("ERPNext Payment Entry Reference child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPaymentEntryReference extends Model {
  constructor(data?: ModelArg<ERPNextPaymentEntryReference>) {
    super(data);
  }

  @description("Doctype of the reference document")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.referenceDoctype.label",
  })
  reference_doctype!: string;

  @description("Name of the reference document")
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.referenceName.label",
  })
  reference_name?: string;

  @description("Reference document due date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.dueDate.label",
    type: "date",
  })
  due_date?: Date;

  @description("Supplier bill number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.billNo.label",
  })
  bill_no?: string;

  @description("Total reference amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.totalAmount.label",
    type: "number",
  })
  total_amount?: number;

  @description("Outstanding reference amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.outstandingAmount.label",
    type: "number",
  })
  outstanding_amount?: number;

  @description("Amount allocated to the reference")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.allocatedAmount.label",
    type: "number",
  })
  allocated_amount?: number;

  @description("Exchange rate applied to the reference")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.exchangeRate.label",
    type: "number",
  })
  exchange_rate?: number;

  @description("Payment term linked to the reference")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.paymentTerm.label",
  })
  payment_term?: string;

  @description("Outstanding amount for the payment term")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.paymentTermOutstanding.label",
    type: "number",
  })
  payment_term_outstanding?: number;

  @description("Payment term discount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.paymentTermDiscount.label",
    type: "number",
  })
  payment_term_discount?: number;

  @description("Account used for the reference")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.account.label",
  })
  account?: string;

  @description("Account type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.accountType.label",
  })
  account_type?: string;

  @description("Payment type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.paymentType.label",
  })
  payment_type?: string;

  @description("Payment request linked to the reference")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.paymentRequest.label",
  })
  payment_request?: string;

  @description("Outstanding amount for the payment request")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.paymentRequestOutstanding.label",
    type: "number",
  })
  payment_request_outstanding?: number;

  @description("Exchange gain or loss")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.exchangeGainLoss.label",
    type: "number",
  })
  exchange_gain_loss?: number;

  @description("Reconcile effect date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.reconcileEffectOn.label",
    type: "date",
  })
  reconcile_effect_on?: Date;

  @description("Advance voucher doctype")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.advanceVoucherType.label",
  })
  advance_voucher_type?: string;

  @description("Advance voucher name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryReference.advanceVoucherNo.label",
  })
  advance_voucher_no?: string;
}

/**
 * @description ERPNext `Payment Entry Deduction` child doctype as a decaf model
 * @summary Child row describing a deduction applied to a Payment Entry, such as a
 * write-off or exchange gain/loss.
 * @class ERPNextPaymentEntryDeduction
 * @category ERPNext
 */
@description("ERPNext Payment Entry Deduction child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPaymentEntryDeduction extends Model {
  constructor(data?: ModelArg<ERPNextPaymentEntryDeduction>) {
    super(data);
  }

  @description("Account the deduction is booked to")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryDeduction.account.label",
  })
  account!: string;

  @description("Cost center of the deduction")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryDeduction.costCenter.label",
  })
  cost_center!: string;

  @description("Deduction amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryDeduction.amount.label",
    type: "number",
  })
  amount!: number;

  @description("Whether the deduction is an exchange gain or loss")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryDeduction.isExchangeGainLoss.label",
    type: "checkbox",
  })
  is_exchange_gain_loss?: boolean;

  @description("Deduction description")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryDeduction.description.label",
  })
  description?: string;

  @description("Dunning linked to the deduction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntryDeduction.dunning.label",
  })
  dunning?: string;
}

/**
 * @description ERPNext `Payment Entry` doctype as a decaf model
 * @summary Payment document that moves money between accounts and settles
 * invoices through its child reference and deduction rows.
 * @class ERPNextPaymentEntry
 * @category ERPNext
 * @example
 * ```typescript
 * const entry = new ERPNextPaymentEntry({
 *   payment_type: "Receive",
 *   party: "ACME",
 * });
 * await Repository.forModel(ERPNextPaymentEntry).create(entry);
 * ```
 */
@uses(ERPNextFlavour)
@description("ERPNext Payment Entry doctype")
@table("Payment Entry")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-credit-card" })
@model()
export class ERPNextPaymentEntry extends Model {
  constructor(data?: ModelArg<ERPNextPaymentEntry>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.name.label",
    placeholder: "erpnext.paymentEntry.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Payment type")
  @required()
  @option([...ERPNextPaymentTypeOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paymentType.label",
    type: "select",
    options: ERPNextPaymentTypeOptions.map((value) => ({ text: value, value })),
  })
  @uilistprop("description")
  payment_type!: string;

  @description("Payment order status")
  @option([...ERPNextPaymentOrderStatusOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paymentOrderStatus.label",
    type: "select",
    options: ERPNextPaymentOrderStatusOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  payment_order_status?: string;

  @description("Payment posting date")
  @required()
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.postingDate.label",
    type: "date",
  })
  posting_date!: Date;

  @description("Company owning the payment")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.company.label",
  })
  company!: string;

  @description("Mode of payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.modeOfPayment.label",
  })
  mode_of_payment?: string;

  @description("Party type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.partyType.label",
  })
  party_type?: string;

  @description("Party linked to the payment")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.party.label",
  })
  party?: string;

  @description("Party display name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.partyName.label",
  })
  party_name?: string;

  @description("Book advance payments in a separate party account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.bookAdvancePaymentsInSeparatePartyAccount.label",
    type: "checkbox",
  })
  book_advance_payments_in_separate_party_account?: boolean;

  @description("Reconcile advance payments on their payment date")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.reconcileOnAdvancePaymentDate.label",
    type: "checkbox",
  })
  reconcile_on_advance_payment_date?: boolean;

  @description("Bank account used by the payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.bankAccount.label",
  })
  bank_account?: string;

  @description("Party bank account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.partyBankAccount.label",
  })
  party_bank_account?: string;

  @description("Contact person")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.contactPerson.label",
  })
  contact_person?: string;

  @description("Contact email")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.contactEmail.label",
    type: "email",
  })
  contact_email?: string;

  @description("Party balance")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.partyBalance.label",
    type: "number",
  })
  party_balance?: number;

  @description("Source account")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidFrom.label",
  })
  paid_from!: string;

  @description("Source account type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidFromAccountType.label",
  })
  paid_from_account_type?: string;

  @description("Source account currency")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidFromAccountCurrency.label",
  })
  paid_from_account_currency!: string;

  @description("Source account balance")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidFromAccountBalance.label",
    type: "number",
  })
  paid_from_account_balance?: number;

  @description("Target account")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidTo.label",
  })
  paid_to!: string;

  @description("Target account type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidToAccountType.label",
  })
  paid_to_account_type?: string;

  @description("Target account currency")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidToAccountCurrency.label",
  })
  paid_to_account_currency!: string;

  @description("Target account balance")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidToAccountBalance.label",
    type: "number",
  })
  paid_to_account_balance?: number;

  @description("Paid amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidAmount.label",
    type: "number",
  })
  paid_amount!: number;

  @description("Paid amount after tax")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paidAmountAfterTax.label",
    type: "number",
  })
  paid_amount_after_tax?: number;

  @description("Source exchange rate")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.sourceExchangeRate.label",
    type: "number",
  })
  source_exchange_rate!: number;

  @description("Base paid amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.basePaidAmount.label",
    type: "number",
  })
  base_paid_amount!: number;

  @description("Base paid amount after tax")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.basePaidAmountAfterTax.label",
    type: "number",
  })
  base_paid_amount_after_tax?: number;

  @description("Received amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.receivedAmount.label",
    type: "number",
  })
  received_amount!: number;

  @description("Received amount after tax")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.receivedAmountAfterTax.label",
    type: "number",
  })
  received_amount_after_tax?: number;

  @description("Target exchange rate")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.targetExchangeRate.label",
    type: "number",
  })
  target_exchange_rate!: number;

  @description("Base received amount")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.baseReceivedAmount.label",
    type: "number",
  })
  base_received_amount!: number;

  @description("Base received amount after tax")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.baseReceivedAmountAfterTax.label",
    type: "number",
  })
  base_received_amount_after_tax?: number;

  @description("Invoice and order references settled by the payment")
  @column()
  @list(() => ERPNextPaymentEntryReference)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.references.label",
    options: () => ERPNextPaymentEntryReference,
  })
  references?: ERPNextPaymentEntryReference[];

  @description("Total allocated amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.totalAllocatedAmount.label",
    type: "number",
  })
  total_allocated_amount?: number;

  @description("Base total allocated amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.baseTotalAllocatedAmount.label",
    type: "number",
  })
  base_total_allocated_amount?: number;

  @description("Unallocated amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.unallocatedAmount.label",
    type: "number",
  })
  unallocated_amount?: number;

  @description("Difference amount")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.differenceAmount.label",
    type: "number",
  })
  difference_amount?: number;

  @description("Deductions applied to the payment")
  @column()
  @list(() => ERPNextPaymentEntryDeduction)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.deductions.label",
    options: () => ERPNextPaymentEntryDeduction,
  })
  deductions?: ERPNextPaymentEntryDeduction[];

  @description("Booked reference number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.referenceNo.label",
  })
  reference_no?: string;

  @description("Booked reference date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.referenceDate.label",
    type: "date",
  })
  reference_date?: Date;

  @description("Bank clearance date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.clearanceDate.label",
    type: "date",
  })
  clearance_date?: Date;

  @description("Project allocated to the payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.project.label",
  })
  project?: string;

  @description("Cost center allocated to the payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.costCenter.label",
  })
  cost_center?: string;

  @description("Payment status")
  @option([...ERPNextPaymentEntryStatusOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.status.label",
    type: "select",
    options: ERPNextPaymentEntryStatusOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  status?: string;

  @description("Custom remarks")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.customRemarks.label",
    type: "checkbox",
  })
  custom_remarks?: boolean;

  @description("Payment remarks")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.remarks.label",
  })
  remarks?: string;

  @description("Opening entry flag")
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.isOpening.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  is_opening?: string;

  @description("Payment order linked to the payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.paymentOrder.label",
  })
  payment_order?: string;

  @description("Original payment entry this one amends")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.amendedFrom.label",
  })
  amended_from?: string;

  @description("Frappe document status (0 draft, 1 submitted, 2 cancelled)")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.docstatus.label",
    type: "number",
  })
  docstatus?: number;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentEntry.modified.label",
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

/**
 * @description ERPNext `Payment Request` doctype as a decaf model
 * @summary Request for payment against an invoice, optionally delivered by email
 * or phone and later settled by a Payment Entry.
 * @class ERPNextPaymentRequest
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Payment Request doctype")
@table("Payment Request")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-mail" })
@model()
export class ERPNextPaymentRequest extends Model {
  constructor(data?: ModelArg<ERPNextPaymentRequest>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.name.label",
    placeholder: "erpnext.paymentRequest.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Payment request direction")
  @required()
  @option([...ERPNextPaymentRequestTypeOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentRequestType.label",
    type: "select",
    options: ERPNextPaymentRequestTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  @uilistprop("description")
  payment_request_type!: string;

  @description("Request transaction date")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.transactionDate.label",
    type: "date",
  })
  transaction_date?: Date;

  @description("Company owning the request")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.company.label",
  })
  company?: string;

  @description("Mode of payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.modeOfPayment.label",
  })
  mode_of_payment?: string;

  @description("Party type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.partyType.label",
  })
  party_type?: string;

  @description("Party linked to the request")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.party.label",
  })
  party?: string;

  @description("Party display name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.partyName.label",
  })
  party_name?: string;

  @description("Doctype of the reference document")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.referenceDoctype.label",
  })
  reference_doctype?: string;

  @description("Name of the reference document")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.referenceName.label",
  })
  reference_name?: string;

  @description("Grand total to request")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.grandTotal.label",
    type: "number",
  })
  grand_total!: number;

  @description("Request currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.currency.label",
  })
  currency?: string;

  @description("Whether the request belongs to a subscription")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.isSubscription.label",
    type: "checkbox",
  })
  is_a_subscription?: boolean;

  @description("Outstanding amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.outstandingAmount.label",
    type: "number",
  })
  outstanding_amount?: number;

  @description("Party account currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.partyAccountCurrency.label",
  })
  party_account_currency?: string;

  @description("Subscription plans included in the request")
  @column()
  @list(() => Object)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.subscriptionPlans.label",
  })
  subscription_plans?: Record<string, unknown>[];

  @description("Bank account to receive the payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.bankAccount.label",
  })
  bank_account?: string;

  @description("Bank linked to the account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.bank.label",
  })
  bank?: string;

  @description("Bank account number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.bankAccountNo.label",
  })
  bank_account_no?: string;

  @description("Payment account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.account.label",
  })
  account?: string;

  @description("IBAN")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.iban.label",
  })
  iban?: string;

  @description("Bank branch code")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.branchCode.label",
  })
  branch_code?: string;

  @description("SWIFT number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.swiftNumber.label",
  })
  swift_number?: string;

  @description("Cost center allocated to the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.costCenter.label",
  })
  cost_center?: string;

  @description("Project allocated to the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.project.label",
  })
  project?: string;

  @description("Payment gateway account used to collect the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentGatewayAccount.label",
  })
  payment_gateway_account?: string;

  @description("Payment request status")
  @option([...ERPNextPaymentRequestStatusOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.status.label",
    type: "select",
    options: ERPNextPaymentRequestStatusOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  status?: string;

  @description("Create a sales invoice from the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.makeSalesInvoice.label",
    type: "checkbox",
  })
  make_sales_invoice?: boolean;

  @description("Payment request message")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.message.label",
  })
  message?: string;

  @description("Mute request emails")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.muteEmail.label",
    type: "checkbox",
  })
  mute_email?: boolean;

  @description("Hosted payment URL")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentUrl.label",
  })
  payment_url?: string;

  @description("Payment gateway used to collect the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentGateway.label",
  })
  payment_gateway?: string;

  @description("Payment account used to collect the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentAccount.label",
  })
  payment_account?: string;

  @description("Payment channel")
  @option([...ERPNextPaymentChannelOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentChannel.label",
    type: "select",
    options: ERPNextPaymentChannelOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  payment_channel?: string;

  @description("Payment order linked to the request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.paymentOrder.label",
  })
  payment_order?: string;

  @description("Original payment request this one amends")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.amendedFrom.label",
  })
  amended_from?: string;

  @description("Phone number used for the payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.phoneNumber.label",
    type: "tel",
  })
  phone_number?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentRequest.modified.label",
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

/**
 * @description ERPNext `Payment Gateway` doctype as a decaf model
 * @summary Registered payment gateway with its public and secret gateway settings,
 * used by the payment provider integrations.
 * @class ERPNextPaymentGateway
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Payment Gateway doctype")
@table("Payment Gateway")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-plug" })
@model()
export class ERPNextPaymentGateway extends Model {
  constructor(data?: ModelArg<ERPNextPaymentGateway>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGateway.name.label",
    placeholder: "erpnext.paymentGateway.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Payment gateway identifier")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGateway.gateway.label",
  })
  @uilistprop("description")
  gateway!: string;

  @description("Doctype holding the gateway credentials")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGateway.gatewaySettings.label",
  })
  gateway_settings?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGateway.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGateway.modified.label",
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

/**
 * @description ERPNext `Payment Gateway Account` doctype as a decaf model
 * @summary Binds a company's payment account to a payment gateway and currency.
 * @class ERPNextPaymentGatewayAccount
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Payment Gateway Account doctype")
@table("Payment Gateway Account")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-wallet" })
@model()
export class ERPNextPaymentGatewayAccount extends Model {
  constructor(data?: ModelArg<ERPNextPaymentGatewayAccount>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.name.label",
    placeholder: "erpnext.paymentGatewayAccount.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Payment gateway")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.paymentGateway.label",
  })
  @uilistprop("description")
  payment_gateway!: string;

  @description("Payment channel")
  @option([...ERPNextPaymentChannelOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.paymentChannel.label",
    type: "select",
    options: ERPNextPaymentChannelOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  payment_channel?: string;

  @description("Company owning the gateway account")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.company.label",
  })
  company!: string;

  @description("Whether this is the default gateway account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.isDefault.label",
    type: "checkbox",
  })
  is_default?: boolean;

  @description("Account that receives the payments")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.paymentAccount.label",
  })
  payment_account!: string;

  @description("Gateway account currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.currency.label",
  })
  currency?: string;

  @description("Message shown with the payment request")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.message.label",
  })
  message?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.paymentGatewayAccount.modified.label",
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
