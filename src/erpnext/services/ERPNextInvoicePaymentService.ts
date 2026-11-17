import { ModelService, repository, service } from "@decaf-ts/core";
import type { Repo } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextPaymentEntry,
  ERPNextPaymentEntryReference,
  ERPNextPaymentRequest,
} from "../models/ERPNextPayment.model";
import { ERPNextSalesInvoice } from "../models/ERPNextSalesInvoice.model";
import { ERPNextPurchaseInvoice } from "../models/ERPNextPurchaseInvoice.model";

/**
 * @description An allocation of a payment entry to an invoice
 * @summary Describes the referenced document and the amount allocated to it.
 * @interface ERPNextPaymentAllocation
 * @property {string} referenceDoctype Referenced doctype
 * @property {string} referenceName Referenced document name
 * @property {number} [amount] Allocated amount
 * @property {number} [outstandingAmount] Outstanding amount at allocation time
 * @property {Date} [dueDate] Reference due date
 * @memberOf module:erpnext
 */
export interface ERPNextPaymentAllocation {
  referenceDoctype: string;
  referenceName: string;
  amount?: number;
  outstandingAmount?: number;
  dueDate?: Date;
}

/**
 * @description Options for recording a payment against an invoice
 * @interface ERPNextInvoicePaymentOptions
 * @property {number} [amount] Amount to pay (defaults to the outstanding amount)
 * @property {string} [modeOfPayment] ERPNext mode of payment
 * @property {string} paidFrom Source account
 * @property {string} paidTo Destination account
 * @property {Date} [postingDate] Posting date
 * @property {string} [referenceNo] External reference number
 * @property {Date} [referenceDate] External reference date
 * @property {string} [costCenter] Cost center
 * @property {string} [project] Project
 * @memberOf module:erpnext
 */
export interface ERPNextInvoicePaymentOptions {
  amount?: number;
  modeOfPayment?: string;
  paidFrom: string;
  paidTo: string;
  postingDate?: Date;
  referenceNo?: string;
  referenceDate?: Date;
  costCenter?: string;
  project?: string;
}

/**
 * @description Options for creating a payment request against an invoice
 * @interface ERPNextInvoicePaymentRequestOptions
 * @property {number} [amount] Requested amount (defaults to the outstanding amount)
 * @property {string} [currency] Currency
 * @property {string} [modeOfPayment] ERPNext mode of payment
 * @property {string} [paymentGatewayAccount] Payment gateway account
 * @property {Date} [transactionDate] Transaction date
 * @property {string} [emailTo] Recipient email
 * @property {string} [subject] Email subject
 * @property {string} [message] Email message
 * @memberOf module:erpnext
 */
export interface ERPNextInvoicePaymentRequestOptions {
  amount?: number;
  currency?: string;
  modeOfPayment?: string;
  paymentGatewayAccount?: string;
  transactionDate?: Date;
  emailTo?: string;
  subject?: string;
  message?: string;
}

type Invoice = ERPNextSalesInvoice | ERPNextPurchaseInvoice;

function isPurchaseInvoice(invoice: Invoice): boolean {
  return "supplier" in invoice;
}

function invoiceDoctype(invoice: Invoice): string {
  return isPurchaseInvoice(invoice) ? "Purchase Invoice" : "Sales Invoice";
}

function invoiceParty(invoice: Invoice): string {
  return isPurchaseInvoice(invoice)
    ? (invoice as ERPNextPurchaseInvoice).supplier
    : (invoice as ERPNextSalesInvoice).customer;
}

function invoiceOutstanding(invoice: Invoice): number {
  return invoice.outstanding_amount ?? invoice.grand_total ?? 0;
}

/**
 * @description Service for applying payments to sales and purchase invoices
 * @summary Creates payment entries and payment requests for invoices, allocates
 * amounts against invoice references and tracks outstanding amounts, supporting
 * both sales and purchase invoices.
 * @class ERPNextInvoicePaymentService
 * @category ERPNext
 * @example
 * ```typescript
 * const payment = await service(ERPNextInvoicePaymentService).recordForInvoice(
 *   invoice,
 *   { paidFrom: "Cash", paidTo: "Debtors" }
 * );
 * ```
 */
@service("ERPNextInvoicePaymentService")
export class ERPNextInvoicePaymentService extends ModelService<ERPNextPaymentEntry> {
  @repository(ERPNextSalesInvoice)
  protected invoiceRepository!: Repo<ERPNextSalesInvoice>;

  @repository(ERPNextPurchaseInvoice)
  protected purchaseInvoiceRepository!: Repo<ERPNextPurchaseInvoice>;

  @repository(ERPNextPaymentRequest)
  protected requestRepository!: Repo<ERPNextPaymentRequest>;

  constructor() {
    super(ERPNextPaymentEntry);
  }

  /**
   * @description Allocates a payment entry to one or more invoices
   * @summary Appends reference rows for each allocation and recomputes the total
   * allocated amount before updating the payment entry.
   * @param {ERPNextPaymentEntry} paymentEntry - The payment entry
   * @param {ERPNextPaymentAllocation[]} allocations - The allocations
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextPaymentEntry>} The updated payment entry
   */
  async allocate(
    paymentEntry: ERPNextPaymentEntry,
    allocations: ERPNextPaymentAllocation[],
    ...args: any[]
  ): Promise<ERPNextPaymentEntry> {
    if (!allocations.length)
      throw new ValidationError(
        `Payment entry ${paymentEntry.name} requires at least one allocation`
      );

    const references = (paymentEntry.references ?? []).map((reference) =>
      Object.assign(new ERPNextPaymentEntryReference(), reference)
    );

    for (const allocation of allocations) {
      references.push(
        new ERPNextPaymentEntryReference({
          reference_doctype: allocation.referenceDoctype,
          reference_name: allocation.referenceName,
          allocated_amount: allocation.amount ?? 0,
          outstanding_amount: allocation.outstandingAmount,
          due_date: allocation.dueDate,
        })
      );
    }

    paymentEntry.references = references;
    paymentEntry.total_allocated_amount = references.reduce(
      (total, reference) => total + (reference.allocated_amount ?? 0),
      0
    );
    return this.update(paymentEntry, ...args);
  }

  /**
   * @description Applies the remaining payment amount to an invoice
   * @summary Allocates the requested amount, capped by the invoice outstanding amount
   * and the unallocated balance of the payment entry.
   * @param {ERPNextPaymentEntry} paymentEntry - The payment entry
   * @param {Invoice} invoice - The sales or purchase invoice
   * @param {number} [amount] - Amount to allocate
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextPaymentEntry>} The updated payment entry
   */
  async applyToInvoice(
    paymentEntry: ERPNextPaymentEntry,
    invoice: Invoice,
    amount?: number,
    ...args: any[]
  ): Promise<ERPNextPaymentEntry> {
    if (!invoice.name)
      throw new ValidationError("Cannot apply a payment to an unsaved invoice");

    const outstanding = invoiceOutstanding(invoice);
    const available = Math.max(
      0,
      (paymentEntry.received_amount ?? paymentEntry.paid_amount ?? 0) -
        (paymentEntry.total_allocated_amount ?? 0)
    );
    const allocated = Math.min(amount ?? available, outstanding);
    if (allocated <= 0)
      throw new ValidationError(
        `Payment entry ${paymentEntry.name} has nothing available to allocate`
      );

    return this.allocate(
      paymentEntry,
      [
        {
          referenceDoctype: invoiceDoctype(invoice),
          referenceName: invoice.name,
          amount: allocated,
          outstandingAmount: outstanding,
          dueDate: invoice.due_date,
        },
      ],
      ...args
    );
  }

  /**
   * @description Records a draft payment entry for an invoice
   * @summary Builds a Receive or Pay payment entry from the invoice party, company,
   * currency and outstanding amount and links it to the invoice.
   * @param {Invoice} invoice - The sales or purchase invoice
   * @param {ERPNextInvoicePaymentOptions} options - Payment options
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextPaymentEntry>} The created payment entry
   */
  async recordForInvoice(
    invoice: Invoice,
    options: ERPNextInvoicePaymentOptions,
    ...args: any[]
  ): Promise<ERPNextPaymentEntry> {
    if (!invoice.name)
      throw new ValidationError("Cannot record a payment for an unsaved invoice");
    if (!options.paidFrom || !options.paidTo)
      throw new ValidationError(
        "Recording a payment requires paidFrom and paidTo accounts"
      );
    if (!invoice.company)
      throw new ValidationError(
        `Invoice ${invoice.name} has no company and cannot be paid`
      );
    if (!invoice.currency)
      throw new ValidationError(
        `Invoice ${invoice.name} has no currency and cannot be paid`
      );
    const purchase = isPurchaseInvoice(invoice);
    const amount = options.amount ?? invoiceOutstanding(invoice);
    if (amount <= 0)
      throw new ValidationError(
        `Invoice ${invoice.name} has no outstanding amount to pay`
      );
    const currency = invoice.currency;

    const paymentEntry = new ERPNextPaymentEntry({
      payment_type: purchase ? "Pay" : "Receive",
      posting_date: options.postingDate ?? new Date(),
      company: invoice.company,
      mode_of_payment: options.modeOfPayment,
      party_type: purchase ? "Supplier" : "Customer",
      party: invoiceParty(invoice),
      paid_from: options.paidFrom,
      paid_to: options.paidTo,
      paid_from_account_currency: currency,
      paid_to_account_currency: currency,
      paid_amount: amount,
      received_amount: amount,
      base_paid_amount: amount,
      base_received_amount: amount,
      source_exchange_rate: 1,
      target_exchange_rate: 1,
      reference_no: options.referenceNo,
      reference_date: options.referenceDate,
      cost_center: options.costCenter,
      project: options.project,
      status: "Draft",
      references: [
        new ERPNextPaymentEntryReference({
          reference_doctype: invoiceDoctype(invoice),
          reference_name: invoice.name,
          total_amount: invoice.grand_total,
          outstanding_amount: invoiceOutstanding(invoice),
          allocated_amount: amount,
          due_date: invoice.due_date,
        }),
      ],
      total_allocated_amount: amount,
    });

    return this.create(paymentEntry, ...args);
  }

  /**
   * @description Reads the outstanding amount of an invoice
   * @param {string} invoiceName - The invoice name
   * @param {string} [referenceDoctype] - The invoice doctype
   * @param {...any} args - Optional repository arguments
   * @return {Promise<number>} The outstanding amount
   */
  async outstandingForInvoice(
    invoiceName: string,
    referenceDoctype: string = "Sales Invoice",
    ...args: any[]
  ): Promise<number> {
    const repository =
      referenceDoctype === "Purchase Invoice"
        ? this.purchaseInvoiceRepository
        : this.invoiceRepository;
    const invoice = (await repository.read(invoiceName, ...args)) as Invoice;
    return invoiceOutstanding(invoice);
  }

  /**
   * @description Creates a payment request for an invoice
   * @summary Creates a Draft `Payment Request` document for the invoice party and
   * outstanding amount.
   * @param {Invoice} invoice - The sales or purchase invoice
   * @param {ERPNextInvoicePaymentRequestOptions} [options] - Request options
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextPaymentRequest>} The created payment request
   */
  async requestForInvoice(
    invoice: Invoice,
    options: ERPNextInvoicePaymentRequestOptions = {},
    ...args: any[]
  ): Promise<ERPNextPaymentRequest> {
    if (!invoice.name)
      throw new ValidationError(
        "Cannot create a payment request for an unsaved invoice"
      );
    const purchase = isPurchaseInvoice(invoice);
    const amount = options.amount ?? invoiceOutstanding(invoice);
    if (amount <= 0)
      throw new ValidationError(
        `Invoice ${invoice.name} has no outstanding amount to request`
      );

    return this.requestRepository.create(
      new ERPNextPaymentRequest({
        payment_request_type: purchase ? "Outward" : "Inward",
        transaction_date: options.transactionDate ?? new Date(),
        company: invoice.company,
        mode_of_payment: options.modeOfPayment,
        party_type: purchase ? "Supplier" : "Customer",
        party: invoiceParty(invoice),
        reference_doctype: invoiceDoctype(invoice),
        reference_name: invoice.name,
        grand_total: amount,
        outstanding_amount: amount,
        currency: options.currency ?? invoice.currency,
        payment_gateway_account: options.paymentGatewayAccount,
        email_to: options.emailTo,
        subject: options.subject,
        message: options.message,
        status: "Draft",
      }),
      ...args
    );
  }

  /**
   * @description Settles a payment request with a payment entry
   * @summary Adds the request reference to the payment entry, marks the request as paid
   * and clears its outstanding amount.
   * @param {ERPNextPaymentRequest} request - The payment request
   * @param {ERPNextPaymentEntry} paymentEntry - The payment entry
   * @param {number} [amount] - Settled amount
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextPaymentRequest>} The updated payment request
   */
  async settleRequest(
    request: ERPNextPaymentRequest,
    paymentEntry: ERPNextPaymentEntry,
    amount?: number,
    ...args: any[]
  ): Promise<ERPNextPaymentRequest> {
    if (!request.name)
      throw new ValidationError("Cannot settle an unsaved payment request");
    if (!paymentEntry.name)
      throw new ValidationError("Cannot settle with an unsaved payment entry");

    if (!request.reference_doctype)
      throw new ValidationError(
        `Payment request ${request.name} has no reference doctype`
      );
    const allocated = amount ?? request.outstanding_amount ?? request.grand_total;
    const references = (paymentEntry.references ?? []).map((reference) =>
      Object.assign(new ERPNextPaymentEntryReference(), reference)
    );
    references.push(
      new ERPNextPaymentEntryReference({
        reference_doctype: request.reference_doctype,
        reference_name: request.reference_name,
        payment_request: request.name,
        allocated_amount: allocated,
        outstanding_amount: request.outstanding_amount,
      })
    );
    paymentEntry.references = references;
    paymentEntry.total_allocated_amount = references.reduce(
      (total, reference) => total + (reference.allocated_amount ?? 0),
      0
    );
    await this.update(paymentEntry, ...args);

    request.status = "Paid";
    request.outstanding_amount = 0;
    return this.requestRepository.update(request, ...args);
  }
}
