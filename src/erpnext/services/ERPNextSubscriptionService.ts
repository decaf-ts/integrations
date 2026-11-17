import { Condition, ModelService, repository, service } from "@decaf-ts/core";
import type { Repo } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextBillingIntervalOptions,
  ERPNextSubscription,
  ERPNextSubscriptionPlan,
} from "../models/ERPNextSubscription.model";
import { ERPNextSalesInvoice } from "../models/ERPNextSalesInvoice.model";
import type { ERPNextRepository } from "../ERPNextRepository";

/**
 * @description Options for cancelling a subscription
 * @interface ERPNextSubscriptionCancelOptions
 * @property {boolean} [atPeriodEnd] Cancel at the end of the current period
 * @property {Date} [date] Cancellation date
 * @memberOf module:erpnext
 */
export interface ERPNextSubscriptionCancelOptions {
  atPeriodEnd?: boolean;
  date?: Date;
}

/**
 * @description Options for generating a subscription invoice
 * @interface ERPNextSubscriptionInvoiceOptions
 * @property {Date} [postingDate] Invoice posting date
 * @property {Date} [dueDate] Invoice due date
 * @property {boolean} [submit] Submit the invoice after creation
 * @memberOf module:erpnext
 */
export interface ERPNextSubscriptionInvoiceOptions {
  postingDate?: Date;
  dueDate?: Date;
  submit?: boolean;
}

type BillingInterval = (typeof ERPNextBillingIntervalOptions)[number];

const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  Day: 0,
  Week: 0,
  Month: 1,
  Year: 12,
};

function addInterval(date: Date, interval: string, count: number): Date {
  const next = new Date(date.getTime());
  const amount = Math.max(1, count || 1);
  if (interval === "Day") {
    next.setUTCDate(next.getUTCDate() + amount);
    return next;
  }
  if (interval === "Week") {
    next.setUTCDate(next.getUTCDate() + amount * 7);
    return next;
  }
  const months = (INTERVAL_MONTHS[interval as BillingInterval] ?? 1) * amount;
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/**
 * @description Service for managing subscription lifecycle and billing
 * @summary Activates, cancels and completes subscriptions, tracks their status,
 * generates sales invoices from their plans and advances billing periods.
 * @class ERPNextSubscriptionService
 * @category ERPNext
 * @example
 * ```typescript
 * const invoice = await service(ERPNextSubscriptionService).generateInvoice(subscription);
 * ```
 */
@service(ERPNextSubscription)
export class ERPNextSubscriptionService extends ModelService<ERPNextSubscription> {
  @repository(ERPNextSubscriptionPlan)
  protected planRepository!: Repo<ERPNextSubscriptionPlan>;

  @repository(ERPNextSalesInvoice)
  protected invoiceRepository!: Repo<ERPNextSalesInvoice>;

  constructor() {
    super(ERPNextSubscription);
  }

  /**
   * @description Activates a subscription
   * @summary Sets the status to `Active`, defaults the start date and backfills the
   * trial start date when a trial end is set.
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async activate(
    subscription: ERPNextSubscription,
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    subscription.status = "Active";
    subscription.start_date ??= new Date();
    if (subscription.trial_period_end && !subscription.trial_period_start)
      subscription.trial_period_start = subscription.start_date;
    return this.update(subscription, ...args);
  }

  /**
   * @description Cancels a subscription
   * @summary Records the cancellation date and either schedules cancellation at period
   * end or immediately marks the subscription `Cancelled`.
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {ERPNextSubscriptionCancelOptions} [options] - Cancellation options
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async cancel(
    subscription: ERPNextSubscription,
    options: ERPNextSubscriptionCancelOptions = {},
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    const date = options.date ?? new Date();
    subscription.cancelation_date = date;
    if (options.atPeriodEnd) {
      subscription.cancel_at_period_end = true;
    } else {
      subscription.cancel_at_period_end = false;
      subscription.status = "Cancelled";
      subscription.end_date = date;
    }
    return this.update(subscription, ...args);
  }

  /**
   * @description Completes a subscription
   * @summary Marks the subscription `Completed` and defaults its end date.
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async complete(
    subscription: ERPNextSubscription,
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    subscription.status = "Completed";
    subscription.end_date ??= new Date();
    return this.update(subscription, ...args);
  }

  /**
   * @description Marks a subscription as past due
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async markPastDue(
    subscription: ERPNextSubscription,
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    subscription.status = "Past Due Date";
    return this.update(subscription, ...args);
  }

  /**
   * @description Marks a subscription as unpaid
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async markUnpaid(
    subscription: ERPNextSubscription,
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    subscription.status = "Unpaid";
    return this.update(subscription, ...args);
  }

  /**
   * @description Lists every subscription for a party
   * @param {string} party - The ERPNext party
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription[]>} The matching subscriptions
   */
  async listForParty(
    party: string,
    ...args: any[]
  ): Promise<ERPNextSubscription[]> {
    return this.repo
      .select()
      .where(Condition.attr<ERPNextSubscription>("party").eq(party))
      .execute(...args);
  }

  /**
   * @description Lists active subscriptions for a party
   * @param {string} party - The ERPNext party
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription[]>} The active subscriptions
   */
  async listActiveForParty(
    party: string,
    ...args: any[]
  ): Promise<ERPNextSubscription[]> {
    return this.repo
      .select()
      .where(
        Condition.attr<ERPNextSubscription>("party")
          .eq(party)
          .and(Condition.attr<ERPNextSubscription>("status").eq("Active"))
      )
      .execute(...args);
  }

  /**
   * @description Generates a sales invoice for a subscription
   * @summary Prices the subscription plans, builds the invoice items, creates the
   * invoice and optionally submits it through Frappe.
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {ERPNextSubscriptionInvoiceOptions} [options] - Invoice options
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSalesInvoice>} The created invoice
   */
  async generateInvoice(
    subscription: ERPNextSubscription,
    options: ERPNextSubscriptionInvoiceOptions = {},
    ...args: any[]
  ): Promise<ERPNextSalesInvoice> {
    if (!subscription.company)
      throw new ValidationError(
        `Subscription ${subscription.name} has no company and cannot be invoiced`
      );
    if (!subscription.plans || !subscription.plans.length)
      throw new ValidationError(
        `Subscription ${subscription.name} has no plans and cannot be invoiced`
      );

    const plans = await Promise.all(
      subscription.plans.map(async (detail) => {
        const plan = await this.planRepository
          .read(detail.plan, ...args)
          .catch(() => undefined);
        return { detail, plan };
      })
    );

    const items = plans.map(({ detail, plan }) => {
      const rate = plan?.cost ?? 0;
      const qty = detail.qty ?? 1;
      return {
        item_code: plan?.item ?? detail.plan,
        item_name: plan?.plan_name ?? plan?.name ?? detail.plan,
        qty,
        rate,
        amount: qty * rate,
        uom: undefined,
      };
    });

    const postingDate = options.postingDate ?? new Date();
    const invoice = new ERPNextSalesInvoice({
      customer: subscription.party,
      company: subscription.company,
      posting_date: postingDate,
      due_date:
        options.dueDate ??
        (subscription.days_until_due
          ? addInterval(postingDate, "Day", subscription.days_until_due)
          : undefined),
      currency: plans.find((entry) => entry.plan?.currency)?.plan?.currency,
      status: options.submit ? "Submitted" : "Draft",
      items,
    });

    const created = await this.invoiceRepository.create(invoice, ...args);

    if (options.submit) {
      const repo = this
        .invoiceRepository as unknown as ERPNextRepository<ERPNextSalesInvoice>;
      await repo.client.callMethod("frappe.client.submit", { doc: created });
    }

    return created;
  }

  /**
   * @description Advances the subscription billing period
   * @summary Computes the next billing period from the plan interval and updates the
   * current invoice start and end dates.
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async advanceBillingPeriod(
    subscription: ERPNextSubscription,
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    if (!subscription.plans || !subscription.plans.length)
      throw new ValidationError(
        `Subscription ${subscription.name} has no plans and cannot advance its billing period`
      );

    const detail = subscription.plans[0];
    const plan = await this.planRepository.read(detail.plan, ...args);
    const start =
      subscription.current_invoice_end ??
      subscription.start_date ??
      new Date();
    const end = addInterval(
      start,
      plan.billing_interval,
      plan.billing_interval_count
    );

    subscription.current_invoice_start = start;
    subscription.current_invoice_end = end;
    return this.update(subscription, ...args);
  }

  /**
   * @description Adds a plan to a subscription
   * @param {ERPNextSubscription} subscription - The subscription
   * @param {string} plan - The subscription plan name
   * @param {number} [qty] - Quantity
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextSubscription>} The updated subscription
   */
  async addPlan(
    subscription: ERPNextSubscription,
    plan: string,
    qty: number = 1,
    ...args: any[]
  ): Promise<ERPNextSubscription> {
    subscription.plans = [
      ...(subscription.plans ?? []),
      { plan, qty },
    ] as ERPNextSubscription["plans"];
    return this.update(subscription, ...args);
  }
}
