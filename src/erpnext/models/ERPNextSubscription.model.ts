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

/**
 * @description Allowed subscription statuses
 * @summary Mirrors the Frappe `Subscription.status` select options.
 * @const ERPNextSubscriptionStatusOptions
 * @memberOf module:erpnext
 */
export const ERPNextSubscriptionStatusOptions = [
  "Trialling",
  "Active",
  "Past Due Date",
  "Cancelled",
  "Unpaid",
  "Completed",
] as const;

/**
 * @description Allowed subscription party types
 * @summary Mirrors the Frappe `Subscription.party_type` select options.
 * @const ERPNextSubscriptionPartyTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextSubscriptionPartyTypeOptions = [
  "Customer",
  "Supplier",
] as const;

/**
 * @description Allowed billing interval units
 * @summary Mirrors the Frappe subscription `billing_interval` unit options.
 * @const ERPNextBillingIntervalOptions
 * @memberOf module:erpnext
 */
export const ERPNextBillingIntervalOptions = [
  "Day",
  "Week",
  "Month",
  "Year",
] as const;

/**
 * @description Allowed invoice generation timings
 * @summary Mirrors the Frappe `Subscription.generate_invoice_at` options.
 * @const ERPNextGenerateInvoiceAtOptions
 * @memberOf module:erpnext
 */
export const ERPNextGenerateInvoiceAtOptions = [
  "End of the current subscription period",
  "Beginning of the current subscription period",
  "Days before the current subscription period",
] as const;

/**
 * @description Allowed subscription price determination modes
 * @summary Mirrors the Frappe `Subscription.price_determination` options.
 * @const ERPNextPriceDeterminationOptions
 * @memberOf module:erpnext
 */
export const ERPNextPriceDeterminationOptions = [
  "Fixed Rate",
  "Based On Price List",
  "Monthly Rate",
] as const;

/**
 * @description Allowed totals a subscription discount applies on
 * @summary Mirrors the Frappe `Subscription.additional_discount_on` options.
 * @const ERPNextDiscountApplyOnOptions
 * @memberOf module:erpnext
 */
export const ERPNextDiscountApplyOnOptions = ["Grand Total", "Net Total"] as const;

/**
 * @description ERPNext `Subscription Plan Detail` child doctype as a decaf model
 * @summary Child row binding an item to a subscription plan with quantity and rate.
 * @class ERPNextSubscriptionPlanDetail
 * @category ERPNext
 */
@description("ERPNext Subscription Plan Detail child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextSubscriptionPlanDetail extends Model {
  constructor(data?: ModelArg<ERPNextSubscriptionPlanDetail>) {
    super(data);
  }

  @description("Subscription plan linked to the subscription")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlanDetail.plan.label",
  })
  plan!: string;

  @description("Quantity of the plan subscribed")
  @required()
  @min(0)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlanDetail.qty.label",
    type: "number",
  })
  qty!: number;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlanDetail.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlanDetail.modified.label",
    type: "datetime-local",
  })
  modified?: Date;
}

/**
 * @description ERPNext `Subscription Plan` doctype as a decaf model
 * @summary Reusable plan with billing interval, price determination and its item
 * detail rows.
 * @class ERPNextSubscriptionPlan
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Subscription Plan doctype")
@table("Subscription Plan")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-layers" })
@model()
export class ERPNextSubscriptionPlan extends Model {
  constructor(data?: ModelArg<ERPNextSubscriptionPlan>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.name.label",
    placeholder: "erpnext.subscriptionPlan.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Display name of the subscription plan")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.planName.label",
  })
  @uilistprop("description")
  plan_name!: string;

  @description("Billing currency")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.currency.label",
  })
  currency!: string;

  @description("Item billed by the plan")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.item.label",
  })
  item!: string;

  @description("How the plan price is determined")
  @required()
  @option([...ERPNextPriceDeterminationOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.priceDetermination.label",
    type: "select",
    options: ERPNextPriceDeterminationOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  price_determination!: string;

  @description("Fixed plan cost")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.cost.label",
    type: "number",
  })
  cost?: number;

  @description("Price list used when pricing from a list")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.priceList.label",
  })
  price_list?: string;

  @description("Billing interval unit")
  @required()
  @option([...ERPNextBillingIntervalOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.billingInterval.label",
    type: "select",
    options: ERPNextBillingIntervalOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  billing_interval!: string;

  @description("Number of billing interval units per period")
  @required()
  @min(1)
  @typeOf(Number)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.billingIntervalCount.label",
    type: "number",
  })
  billing_interval_count!: number;

  @description("Payment provider product price identifier")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.productPriceId.label",
  })
  product_price_id?: string;

  @description("Payment gateway account used to collect the plan")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.paymentGateway.label",
  })
  payment_gateway?: string;

  @description("Cost center allocated to the plan")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.costCenter.label",
  })
  cost_center?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscriptionPlan.modified.label",
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
 * @description ERPNext `Subscription` doctype as a decaf model
 * @summary Active subscription for a party, driven by
 * {@link ERPNextSubscriptionService} for activation, invoicing and cancellation.
 * @class ERPNextSubscription
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Subscription doctype")
@table("Subscription")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-reload" })
@model()
export class ERPNextSubscription extends Model {
  constructor(data?: ModelArg<ERPNextSubscription>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.name.label",
    placeholder: "erpnext.subscription.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Party type the subscription bills")
  @required()
  @option([...ERPNextSubscriptionPartyTypeOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.partyType.label",
    type: "select",
    options: ERPNextSubscriptionPartyTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  party_type!: string;

  @description("Party linked to the subscription")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.party.label",
  })
  @uilistprop("description")
  party!: string;

  @description("Company owning the subscription")
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.company.label",
  })
  company?: string;

  @description("Subscription lifecycle status")
  @option([...ERPNextSubscriptionStatusOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.status.label",
    type: "select",
    options: ERPNextSubscriptionStatusOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  status?: string;

  @description("Subscription start date")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.startDate.label",
    type: "date",
  })
  start_date?: Date;

  @description("Subscription end date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.endDate.label",
    type: "date",
  })
  end_date?: Date;

  @description("Cancellation date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.cancelationDate.label",
    type: "date",
  })
  cancelation_date?: Date;

  @description("Trial period start date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.trialPeriodStart.label",
    type: "date",
  })
  trial_period_start?: Date;

  @description("Trial period end date")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.trialPeriodEnd.label",
    type: "date",
  })
  trial_period_end?: Date;

  @description("Whether billing follows calendar months")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.followCalendarMonths.label",
    type: "checkbox",
  })
  follow_calendar_months?: boolean;

  @description("Whether overdue invoices are still generated")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.generateNewInvoicesPastDueDate.label",
    type: "checkbox",
  })
  generate_new_invoices_past_due_date?: boolean;

  @description("Whether generated invoices are submitted automatically")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.submitInvoice.label",
    type: "checkbox",
  })
  submit_invoice?: boolean;

  @description("Start of the current billing period")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.currentInvoiceStart.label",
    type: "date",
  })
  current_invoice_start?: Date;

  @description("End of the current billing period")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.currentInvoiceEnd.label",
    type: "date",
  })
  current_invoice_end?: Date;

  @description("Days until the generated invoice is due")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.daysUntilDue.label",
    type: "number",
  })
  days_until_due?: number;

  @description("When the subscription invoice is generated")
  @required()
  @option([...ERPNextGenerateInvoiceAtOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.generateInvoiceAt.label",
    type: "select",
    options: ERPNextGenerateInvoiceAtOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  generate_invoice_at!: string;

  @description("Days before the period used when generating early invoices")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.numberOfDays.label",
    type: "number",
  })
  number_of_days?: number;

  @description("Cancel the subscription at the end of the current period")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.cancelAtPeriodEnd.label",
    type: "checkbox",
  })
  cancel_at_period_end?: boolean;

  @description("Plans included in the subscription")
  @required()
  @column()
  @list(() => ERPNextSubscriptionPlanDetail)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.plans.label",
    options: () => ERPNextSubscriptionPlanDetail,
  })
  plans!: ERPNextSubscriptionPlanDetail[];

  @description("Sales taxes and charges template")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.salesTaxTemplate.label",
  })
  sales_tax_template?: string;

  @description("Purchase taxes and charges template")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.purchaseTaxTemplate.label",
  })
  purchase_tax_template?: string;

  @description("Discount base for the subscription")
  @option([...ERPNextDiscountApplyOnOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.applyAdditionalDiscount.label",
    type: "select",
    options: ERPNextDiscountApplyOnOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  apply_additional_discount?: string;

  @description("Additional discount percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.additionalDiscountPercentage.label",
    type: "number",
  })
  additional_discount_percentage?: number;

  @description("Additional discount amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.additionalDiscountAmount.label",
    type: "number",
  })
  additional_discount_amount?: number;

  @description("Cost center allocated to the subscription")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.costCenter.label",
  })
  cost_center?: string;

  @description("Frappe document status (0 draft, 1 submitted, 2 cancelled)")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.docstatus.label",
    type: "number",
  })
  docstatus?: number;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.subscription.modified.label",
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
