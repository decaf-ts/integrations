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
import { ERPNextYesNoOptions } from "./ERPNextPayment.model";

/**
 * @description Allowed ERPNext journal entry voucher types
 * @summary Mirrors the Frappe `Journal Entry.voucher_type` select options.
 * @const ERPNextJournalEntryVoucherTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextJournalEntryVoucherTypeOptions = [
  "Journal Entry",
  "Inter Company Journal Entry",
  "Bank Entry",
  "Cash Entry",
  "Credit Card Entry",
  "Debit Note",
  "Credit Note",
  "Contra Entry",
  "Excise Entry",
  "Write Off Entry",
  "Opening Entry",
  "Depreciation Entry",
  "Exchange Rate Revaluation",
  "Exchange Gain Or Loss",
  "Deferred Revenue",
  "Deferred Expense",
] as const;

/**
 * @description Allowed reference doctypes for journal entry rows
 * @summary Mirrors the Frappe `Journal Entry Account.reference_type` options.
 * @const ERPNextJournalEntryReferenceTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextJournalEntryReferenceTypeOptions = [
  "Sales Invoice",
  "Purchase Invoice",
  "Journal Entry",
  "Sales Order",
  "Purchase Order",
  "Expense Claim",
  "Asset",
  "Loan",
  "Payroll Entry",
  "Employee Advance",
  "Exchange Rate Revaluation",
  "Invoice Discounting",
  "Fees",
  "Full and Final Statement",
  "Payment Entry",
  "Bank Transaction",
] as const;

/**
 * @description Allowed account root types
 * @summary Mirrors the Frappe `Account.root_type` select options.
 * @const ERPNextRootTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextRootTypeOptions = [
  "Asset",
  "Liability",
  "Income",
  "Expense",
  "Equity",
] as const;

/**
 * @description Allowed financial report types
 * @summary Mirrors the Frappe `Account.report_type` select options.
 * @const ERPNextReportTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextReportTypeOptions = [
  "Balance Sheet",
  "Profit and Loss",
] as const;

/**
 * @description Allowed account types
 * @summary Mirrors the Frappe `Account.account_type` select options.
 * @const ERPNextAccountTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextAccountTypeOptions = [
  "Accumulated Depreciation",
  "Asset Received But Not Billed",
  "Bank",
  "Cash",
  "Chargeable",
  "Capital Work in Progress",
  "Cost of Goods Sold",
  "Current Asset",
  "Current Liability",
  "Depreciation",
  "Direct Expense",
  "Direct Income",
  "Equity",
  "Expense Account",
  "Expenses Included In Asset Valuation",
  "Expenses Included In Valuation",
  "Fixed Asset",
  "Income Account",
  "Indirect Expense",
  "Indirect Income",
  "Liability",
  "Payable",
  "Receivable",
  "Round Off",
  "Round Off for Opening",
  "Stock",
  "Stock Adjustment",
  "Stock Received But Not Billed",
  "Service Received But Not Billed",
  "Tax",
  "Temporary",
] as const;

/**
 * @description Allowed balance sides for an account
 * @summary Mirrors the Frappe `Account.balance_must_be` select options.
 * @const ERPNextBalanceMustBeOptions
 * @memberOf module:erpnext
 */
export const ERPNextBalanceMustBeOptions = ["Debit", "Credit"] as const;

/**
 * @description Allowed write-off bases for an account
 * @summary Mirrors the Frappe `Account.write_off_based_on` select options.
 * @const ERPNextWriteOffBasedOnOptions
 * @memberOf module:erpnext
 */
export const ERPNextWriteOffBasedOnOptions = [
  "Accounts Receivable",
  "Accounts Payable",
] as const;

/**
 * @description ERPNext `Journal Entry Account` child doctype as a decaf model
 * @summary Child row embedded in a Journal Entry, mapping debit, credit, party and
 * reference fields. It is decorated for validation and for the default for-angular
 * CRUD form component.
 * @class ERPNextJournalEntryAccount
 * @category ERPNext
 */
@description("ERPNext Journal Entry Account child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextJournalEntryAccount extends Model {
  constructor(data?: ModelArg<ERPNextJournalEntryAccount>) {
    super(data);
  }

  @description("Account to debit or credit")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.account.label",
  })
  account!: string;

  @description("Account type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.accountType.label",
  })
  account_type?: string;

  @description("Bank account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.bankAccount.label",
  })
  bank_account?: string;

  @description("Party type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.partyType.label",
  })
  party_type?: string;

  @description("Party linked to the account row")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.party.label",
  })
  party?: string;

  @description("Cost center")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.costCenter.label",
  })
  cost_center?: string;

  @description("Project")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.project.label",
  })
  project?: string;

  @description("Account currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.accountCurrency.label",
  })
  account_currency?: string;

  @description("Exchange rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.exchangeRate.label",
    type: "number",
  })
  exchange_rate?: number;

  @description("Debit amount in account currency")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.debitInAccountCurrency.label",
    type: "number",
  })
  debit_in_account_currency?: number;

  @description("Debit amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.debit.label",
    type: "number",
  })
  debit?: number;

  @description("Credit amount in account currency")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.creditInAccountCurrency.label",
    type: "number",
  })
  credit_in_account_currency?: number;

  @description("Credit amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.credit.label",
    type: "number",
  })
  credit?: number;

  @description("Reference document type")
  @option([...ERPNextJournalEntryReferenceTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.referenceType.label",
    type: "select",
    options: ERPNextJournalEntryReferenceTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  reference_type?: string;

  @description("Reference document name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.referenceName.label",
  })
  reference_name?: string;

  @description("Reference due date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.referenceDueDate.label",
    type: "date",
  })
  reference_due_date?: Date;

  @description("Reference detail number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.referenceDetailNo.label",
  })
  reference_detail_no?: string;

  @description("Advance voucher type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.advanceVoucherType.label",
  })
  advance_voucher_type?: string;

  @description("Advance voucher name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.advanceVoucherNo.label",
  })
  advance_voucher_no?: string;

  @description("Whether the account is a tax withholding account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.isTaxWithholdingAccount.label",
    type: "checkbox",
  })
  is_tax_withholding_account?: boolean;

  @description("Whether the row is an advance")
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.isAdvance.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  is_advance?: string;

  @description("User remark")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.userRemark.label",
  })
  user_remark?: string;

  @description("Against account")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntryAccount.againstAccount.label",
  })
  against_account?: string;
}

/**
 * @description ERPNext `Journal Entry` doctype as a decaf model
 * @summary Accounting journal entry with its child account rows. The primary key
 * is the Frappe document `name`; every persisted attribute maps to the identically
 * named Journal Entry field.
 * @class ERPNextJournalEntry
 * @category ERPNext
 * @example
 * ```typescript
 * const entry = new ERPNextJournalEntry({ voucher_type: "Journal Entry" });
 * await Repository.forModel(ERPNextJournalEntry).create(entry);
 * ```
 */
@uses(ERPNextFlavour)
@description("ERPNext Journal Entry doctype")
@table("Journal Entry")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-book" })
@model()
export class ERPNextJournalEntry extends Model {
  constructor(data?: ModelArg<ERPNextJournalEntry>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.name.label",
    placeholder: "erpnext.journalEntry.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Whether the entry is system generated")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.isSystemGenerated.label",
    type: "checkbox",
  })
  is_system_generated?: boolean;

  @description("Journal entry title")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.title.label",
  })
  title?: string;

  @description("Voucher type")
  @required()
  @option([...ERPNextJournalEntryVoucherTypeOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.voucherType.label",
    type: "select",
    options: ERPNextJournalEntryVoucherTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  @uilistprop("description")
  voucher_type!: string;

  @description("Finance book")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.financeBook.label",
  })
  finance_book?: string;

  @description("Journal entry this one reverses")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.reversalOf.label",
  })
  reversal_of?: string;

  @description("Tax withholding category")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.taxWithholdingCategory.label",
  })
  tax_withholding_category?: string;

  @description("Journal entry template")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.fromTemplate.label",
  })
  from_template?: string;

  @description("Company owning the entry")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.company.label",
  })
  company!: string;

  @description("Posting date")
  @required()
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.postingDate.label",
    type: "date",
  })
  posting_date!: Date;

  @description("Apply tax deduction at source")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.applyTds.label",
    type: "checkbox",
  })
  apply_tds?: boolean;

  @description("Journal entry account rows")
  @required()
  @column()
  @list(() => ERPNextJournalEntryAccount)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.accounts.label",
    options: () => ERPNextJournalEntryAccount,
  })
  accounts!: ERPNextJournalEntryAccount[];

  @description("Cheque number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.chequeNo.label",
  })
  cheque_no?: string;

  @description("Cheque date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.chequeDate.label",
    type: "date",
  })
  cheque_date?: Date;

  @description("User remark")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.userRemark.label",
  })
  user_remark?: string;

  @description("Total debit")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.totalDebit.label",
    type: "number",
  })
  total_debit?: number;

  @description("Total credit")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.totalCredit.label",
    type: "number",
  })
  total_credit?: number;

  @description("Debit and credit difference")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.difference.label",
    type: "number",
  })
  difference?: number;

  @description("Whether the entry is multi currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.multiCurrency.label",
    type: "checkbox",
  })
  multi_currency?: boolean;

  @description("Total amount currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.totalAmountCurrency.label",
  })
  total_amount_currency?: string;

  @description("Total amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.totalAmount.label",
    type: "number",
  })
  total_amount?: number;

  @description("Bank clearance date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.clearanceDate.label",
    type: "date",
  })
  clearance_date?: Date;

  @description("Entry remark")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.remark.label",
  })
  remark?: string;

  @description("Supplier bill number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.billNo.label",
  })
  bill_no?: string;

  @description("Supplier bill date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.billDate.label",
    type: "date",
  })
  bill_date?: Date;

  @description("Due date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.dueDate.label",
    type: "date",
  })
  due_date?: Date;

  @description("Write off based on")
  @option([...ERPNextWriteOffBasedOnOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.writeOffBasedOn.label",
    type: "select",
    options: ERPNextWriteOffBasedOnOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  write_off_based_on?: string;

  @description("Write off amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.writeOffAmount.label",
    type: "number",
  })
  write_off_amount?: number;

  @description("Pay to or receive from")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.payToRecdFrom.label",
  })
  pay_to_recd_from?: string;

  @description("Mode of payment")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.modeOfPayment.label",
  })
  mode_of_payment?: string;

  @description("Payment order")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.paymentOrder.label",
  })
  payment_order?: string;

  @description("Opening entry flag")
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.isOpening.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  is_opening?: string;

  @description("Original journal entry this one amends")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.amendedFrom.label",
  })
  amended_from?: string;

  @description("Frappe document status (0 draft, 1 submitted, 2 cancelled)")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.docstatus.label",
    type: "number",
  })
  docstatus?: number;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.journalEntry.modified.label",
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
 * @description ERPNext `Account` doctype as a decaf model
 * @summary Chart-of-accounts entry with root type, account type and balance
 * constraints used by the accounting and chart-of-accounts services.
 * @class ERPNextAccount
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Account doctype")
@table("Account")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-list" })
@model()
export class ERPNextAccount extends Model {
  constructor(data?: ModelArg<ERPNextAccount>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.name.label",
    placeholder: "erpnext.account.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Account name")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.accountName.label",
  })
  @uilistprop("description")
  account_name!: string;

  @description("Account number")
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.accountNumber.label",
  })
  account_number?: string;

  @description("Whether the account is a group")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.isGroup.label",
    type: "checkbox",
  })
  is_group?: boolean;

  @description("Company owning the account")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.company.label",
  })
  company!: string;

  @description("Root type of the account")
  @option([...ERPNextRootTypeOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.rootType.label",
    type: "select",
    options: ERPNextRootTypeOptions.map((value) => ({ text: value, value })),
  })
  root_type?: string;

  @description("Report type the account feeds")
  @option([...ERPNextReportTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.reportType.label",
    type: "select",
    options: ERPNextReportTypeOptions.map((value) => ({ text: value, value })),
  })
  report_type?: string;

  @description("Account currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.accountCurrency.label",
  })
  account_currency?: string;

  @description("Parent account in the chart of accounts")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.parentAccount.label",
  })
  parent_account!: string;

  @description("ERPNext account type")
  @option([...ERPNextAccountTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.accountType.label",
    type: "select",
    options: ERPNextAccountTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  account_type?: string;

  @description("Tax rate applied to the account")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.taxRate.label",
    type: "number",
  })
  tax_rate?: number;

  @description("Freeze the account")
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.freezeAccount.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  freeze_account?: string;

  @description("Required account balance side")
  @option([...ERPNextBalanceMustBeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.balanceMustBe.label",
    type: "select",
    options: ERPNextBalanceMustBeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  balance_must_be?: string;

  @description("Nested set left index")
  @column()
  lft?: number;

  @description("Nested set right index")
  @column()
  rgt?: number;

  @description("Previous parent account")
  @column()
  old_parent?: string;

  @description("Include the account in gross profit")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.includeInGross.label",
    type: "checkbox",
  })
  include_in_gross?: boolean;

  @description("Whether the account is disabled")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.disabled.label",
    type: "checkbox",
  })
  disabled?: boolean;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.account.modified.label",
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
 * @description ERPNext `Fiscal Year Company` child doctype as a decaf model
 * @summary Child row listing the companies included in a Fiscal Year.
 * @class ERPNextFiscalYearCompany
 * @category ERPNext
 */
@description("ERPNext Fiscal Year Company child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextFiscalYearCompany extends Model {
  constructor(data?: ModelArg<ERPNextFiscalYearCompany>) {
    super(data);
  }

  @description("Company included in the fiscal year")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYearCompany.company.label",
  })
  company!: string;
}

/**
 * @description ERPNext `Fiscal Year` doctype as a decaf model
 * @summary Fiscal period definition with its included companies.
 * @class ERPNextFiscalYear
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Fiscal Year doctype")
@table("Fiscal Year")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-calendar" })
@model()
export class ERPNextFiscalYear extends Model {
  constructor(data?: ModelArg<ERPNextFiscalYear>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.name.label",
    placeholder: "erpnext.fiscalYear.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Fiscal year label")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.year.label",
  })
  @uilistprop("description")
  year!: string;

  @description("Whether the fiscal year is disabled")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.disabled.label",
    type: "checkbox",
  })
  disabled?: boolean;

  @description("Whether the fiscal year is a short year")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.isShortYear.label",
    type: "checkbox",
  })
  is_short_year?: boolean;

  @description("Fiscal year start date")
  @required()
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.yearStartDate.label",
    type: "date",
  })
  year_start_date!: Date;

  @description("Fiscal year end date")
  @required()
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.yearEndDate.label",
    type: "date",
  })
  year_end_date!: Date;

  @description("Companies included in the fiscal year")
  @column()
  @list(() => ERPNextFiscalYearCompany)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.companies.label",
    options: () => ERPNextFiscalYearCompany,
  })
  companies?: ERPNextFiscalYearCompany[];

  @description("Whether the fiscal year was auto created")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.autoCreated.label",
    type: "checkbox",
  })
  auto_created?: boolean;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.fiscalYear.modified.label",
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
 * @description ERPNext `GL Entry` doctype as a read-only decaf model
 * @summary General ledger row produced by posted vouchers. It is treated as a
 * read-only projection; writes should go through the originating documents.
 * @class ERPNextGLEntry
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext GL Entry read-only ledger row")
@table("GL Entry")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-archive" })
@model()
export class ERPNextGLEntry extends Model {
  constructor(data?: ModelArg<ERPNextGLEntry>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.name.label",
    placeholder: "erpnext.glEntry.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Ledger posting date")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.postingDate.label",
    type: "date",
  })
  posting_date?: Date;

  @description("Transaction date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.transactionDate.label",
    type: "date",
  })
  transaction_date?: Date;

  @description("Fiscal year")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.fiscalYear.label",
  })
  fiscal_year?: string;

  @description("Due date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.dueDate.label",
    type: "date",
  })
  due_date?: Date;

  @description("Account")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.account.label",
  })
  @uilistprop("description")
  account?: string;

  @description("Account currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.accountCurrency.label",
  })
  account_currency?: string;

  @description("Against account or party")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.against.label",
  })
  against?: string;

  @description("Party type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.partyType.label",
  })
  party_type?: string;

  @description("Party")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.party.label",
  })
  party?: string;

  @description("Voucher type")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.voucherType.label",
  })
  voucher_type?: string;

  @description("Voucher name")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.voucherNo.label",
  })
  voucher_no?: string;

  @description("Voucher subtype")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.voucherSubtype.label",
  })
  voucher_subtype?: string;

  @description("Transaction currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.transactionCurrency.label",
  })
  transaction_currency?: string;

  @description("Against voucher type")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.againstVoucherType.label",
  })
  against_voucher_type?: string;

  @description("Against voucher name")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.againstVoucher.label",
  })
  against_voucher?: string;

  @description("Voucher detail number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.voucherDetailNo.label",
  })
  voucher_detail_no?: string;

  @description("Transaction exchange rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.transactionExchangeRate.label",
    type: "number",
  })
  transaction_exchange_rate?: number;

  @description("Debit amount in account currency")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.debitInAccountCurrency.label",
    type: "number",
  })
  debit_in_account_currency?: number;

  @description("Debit amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.debit.label",
    type: "number",
  })
  debit?: number;

  @description("Debit amount in transaction currency")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.debitInTransactionCurrency.label",
    type: "number",
  })
  debit_in_transaction_currency?: number;

  @description("Credit amount in account currency")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.creditInAccountCurrency.label",
    type: "number",
  })
  credit_in_account_currency?: number;

  @description("Credit amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.credit.label",
    type: "number",
  })
  credit?: number;

  @description("Credit amount in transaction currency")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.creditInTransactionCurrency.label",
    type: "number",
  })
  credit_in_transaction_currency?: number;

  @description("Cost center")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.costCenter.label",
  })
  cost_center?: string;

  @description("Project")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.project.label",
  })
  project?: string;

  @description("Finance book")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.financeBook.label",
  })
  finance_book?: string;

  @description("Company")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.company.label",
  })
  company?: string;

  @description("Opening entry flag")
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.isOpening.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  is_opening?: string;

  @description("Advance entry flag")
  @option([...ERPNextYesNoOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.isAdvance.label",
    type: "select",
    options: ERPNextYesNoOptions.map((value) => ({ text: value, value })),
  })
  is_advance?: string;

  @description("Whether the ledger row is cancelled")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.isCancelled.label",
    type: "checkbox",
  })
  is_cancelled?: boolean;

  @description("Ledger remark")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.remarks.label",
  })
  remarks?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.glEntry.modified.label",
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
 * @description ERPNext chart-of-accounts tree node read model
 * @summary Non-persisted projection used by {@link ERPNextChartOfAccountsService}
 * to return account trees with parent/child relationships.
 * @class ERPNextChartOfAccountsNode
 * @category ERPNext
 */
@description("ERPNext Chart of Accounts tree node (read model)")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-sitemap" })
@model()
export class ERPNextChartOfAccountsNode extends Model {
  constructor(data?: ModelArg<ERPNextChartOfAccountsNode>) {
    super(data);
  }

  @description("Account document name")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.account.label",
  })
  @uilistprop("title")
  account?: string;

  @description("Account name")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.accountName.label",
  })
  @uilistprop("description")
  account_name?: string;

  @description("Parent account")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.parentAccount.label",
  })
  parent_account?: string;

  @description("Root type")
  @option([...ERPNextRootTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.rootType.label",
    type: "select",
    options: ERPNextRootTypeOptions.map((value) => ({ text: value, value })),
  })
  root_type?: string;

  @description("Account type")
  @option([...ERPNextAccountTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.accountType.label",
    type: "select",
    options: ERPNextAccountTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  account_type?: string;

  @description("Whether the account is a group")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.isGroup.label",
    type: "checkbox",
  })
  is_group?: boolean;

  @description("Child accounts")
  @column()
  @list(() => ERPNextChartOfAccountsNode)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.chartOfAccounts.children.label",
    options: () => ERPNextChartOfAccountsNode,
  })
  children?: ERPNextChartOfAccountsNode[];
}
