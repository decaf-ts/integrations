/**
 * @module integrations/tests/unit/erpnext/ERPNextInvoicePaymentService
 * @summary Unit coverage for the ERPNext invoice payment model service. The
 * adapter transport is injected and Frappe resource envelopes are mocked, so no
 * ERPNext site, network or credentials are required.
 */
import { it } from "@decaf-ts/for-testing";
import { beforeAll, beforeEach, describe, expect } from "@jest/globals";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextAdapter,
  ERPNextFlavour,
  ERPNextInvoicePaymentService,
  ERPNextPaymentEntry,
  ERPNextPaymentEntryReference,
  ERPNextPaymentRequest,
  ERPNextPurchaseInvoice,
  ERPNextPurchaseInvoiceItem,
  ERPNextSalesInvoice,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

const documents: Record<string, Record<string, any>> = {
  "Payment Entry": {
    "PE-1": {
      name: "PE-1",
      payment_type: "Receive",
      posting_date: "2026-01-05 00:00:00",
      company: "ACME",
      paid_from: "Debtors",
      paid_from_account_currency: "USD",
      paid_to: "Cash",
      paid_to_account_currency: "USD",
      paid_amount: 100,
      source_exchange_rate: 1,
      base_paid_amount: 100,
      received_amount: 100,
      target_exchange_rate: 1,
      base_received_amount: 100,
    },
  },
  "Payment Request": {
    "PREQ-1": {
      name: "PREQ-1",
      payment_request_type: "Inward",
      reference_doctype: "Sales Invoice",
      reference_name: "SINV-1",
      grand_total: 50,
      outstanding_amount: 40,
    },
  },
  "Sales Invoice": {
    "SINV-1": {
      name: "SINV-1",
      customer: "ACME",
      company: "ACME",
      posting_date: "2026-01-01",
      currency: "USD",
      grand_total: 100,
      outstanding_amount: 100,
    },
    "SINV-FALLBACK": {
      name: "SINV-FALLBACK",
      customer: "ACME",
      company: "ACME",
      posting_date: "2026-01-01",
      currency: "USD",
      grand_total: 40,
    },
  },
  "Purchase Invoice": {
    "PINV-1": {
      name: "PINV-1",
      supplier: "SUP-1",
      company: "ACME",
      posting_date: "2026-01-01",
      currency: "USD",
      grand_total: 75,
      outstanding_amount: 75,
    },
  },
};

const baseDocuments = JSON.parse(JSON.stringify(documents));

const calls: ERPNextHttpRequest[] = [];

function pathOf(call: ERPNextHttpRequest): string {
  return decodeURIComponent(new URL(call.url).pathname);
}

function route(request: ERPNextHttpRequest): ERPNextHttpResponse {
  const path = pathOf(request);
  const method = request.method;
  const body = (request.data ?? {}) as Record<string, any>;
  const resource = path.match(/^\/api\/resource\/([^/]+)(?:\/([^/]+))?$/);
  if (resource) {
    const doctype = resource[1];
    const name = resource[2];
    documents[doctype] = documents[doctype] ?? {};
    if (method === "GET" && name) {
      const document = documents[doctype][name];
      return document
        ? { status: 200, data: { data: document } }
        : { status: 404, data: { exc_type: "DoesNotExistError" } };
    }
    if (method === "PUT" && name) {
      const updated = { ...documents[doctype][name], ...body, name };
      documents[doctype][name] = updated;
      return { status: 200, data: { data: updated } };
    }
    if (method === "POST" && !name) {
      const created = { name: body.name ?? `${doctype.replace(/\s+/g, "-")}-NEW`, ...body };
      documents[doctype][created.name] = created;
      return { status: 200, data: { data: created } };
    }
  }
  return { status: 404, data: { exc_type: "DoesNotExistError" } };
}

const transport: ERPNextTransport = async (request) => {
  calls.push(request);
  return route(request);
};

function paymentEntry(
  data: Partial<ERPNextPaymentEntry> = {}
): ERPNextPaymentEntry {
  return new ERPNextPaymentEntry({
    name: "PE-1",
    payment_type: "Receive",
    posting_date: new Date("2026-01-05T00:00:00.000Z"),
    company: "ACME",
    paid_from: "Debtors",
    paid_from_account_currency: "USD",
    paid_to: "Cash",
    paid_to_account_currency: "USD",
    paid_amount: 100,
    source_exchange_rate: 1,
    base_paid_amount: 100,
    received_amount: 100,
    target_exchange_rate: 1,
    base_received_amount: 100,
    ...data,
  });
}

function salesInvoice(
  data: Partial<ERPNextSalesInvoice> = {}
): ERPNextSalesInvoice {
  return new ERPNextSalesInvoice({
    name: "SINV-1",
    customer: "ACME",
    company: "ACME",
    posting_date: new Date("2026-01-01T00:00:00.000Z"),
    currency: "USD",
    grand_total: 100,
    outstanding_amount: 100,
    ...data,
  });
}

function purchaseInvoice(
  data: Partial<ERPNextPurchaseInvoice> = {}
): ERPNextPurchaseInvoice {
  return new ERPNextPurchaseInvoice({
    name: "PINV-1",
    supplier: "SUP-1",
    company: "ACME",
    posting_date: new Date("2026-01-01T00:00:00.000Z"),
    currency: "USD",
    grand_total: 75,
    outstanding_amount: 75,
    items: [new ERPNextPurchaseInvoiceItem({ item_name: "Widget", qty: 1 })],
    ...data,
  });
}

function find(method: string, path: string) {
  return calls.find((call) => call.method === method && pathOf(call) === path);
}

describe("ERPNextInvoicePaymentService", () => {
  let service: ERPNextInvoicePaymentService;

  beforeAll(async () => {
    const adapter = new ERPNextAdapter(
      {
        baseUrl: "https://erp.example.com",
        apiKey: "key",
        apiSecret: "secret",
        transport,
      },
      ERPNextFlavour
    );
    await adapter.initialize();
    service = new ERPNextInvoicePaymentService();
  });

  beforeEach(() => {
    calls.length = 0;
    for (const doctype of Object.keys(documents)) delete documents[doctype];
    Object.assign(documents, JSON.parse(JSON.stringify(baseDocuments)));
  });

  it("merges reference rows and recomputes the allocated total", async () => {
    const entry = paymentEntry({
      references: [
        new ERPNextPaymentEntryReference({
          reference_doctype: "Sales Invoice",
          reference_name: "SINV-0",
          allocated_amount: 30,
        }),
      ],
    });

    const allocated = await service.allocate(
      entry,
      [
        { referenceDoctype: "Sales Invoice", referenceName: "SINV-1", amount: 20 },
        { referenceDoctype: "Sales Invoice", referenceName: "SINV-2", amount: 50 },
      ],
      );

    expect(entry.references).toHaveLength(3);
    expect(allocated.total_allocated_amount).toBe(100);
    expect(entry.total_allocated_amount).toBe(100);

    const put = find("PUT", "/api/resource/Payment Entry/PE-1");
    expect(put).toBeTruthy();
    const body = put!.data as Record<string, any>;
    expect(body.references).toHaveLength(3);
    expect(body.total_allocated_amount).toBe(100);
  });

  it("requires at least one allocation", async () => {
    await expect(
      service.allocate(paymentEntry(), [])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("caps a payment at the invoice outstanding amount", async () => {
    const entry = paymentEntry({ received_amount: 500, paid_amount: 500 });
    const invoice = salesInvoice({ outstanding_amount: 100, grand_total: 100 });

    await service.applyToInvoice(entry, invoice, 250);

    expect(entry.total_allocated_amount).toBe(100);
    expect(entry.references).toHaveLength(1);
    expect(entry.references?.[0].allocated_amount).toBe(100);
    expect(entry.references?.[0].reference_name).toBe("SINV-1");
  });

  it("uses the amount still available on the entry when none is given", async () => {
    const entry = paymentEntry({
      received_amount: 100,
      total_allocated_amount: 80,
    });
    const invoice = salesInvoice({ outstanding_amount: 1000, grand_total: 1000 });

    await service.applyToInvoice(entry, invoice, undefined);

    expect(entry.references?.[0].allocated_amount).toBe(20);
    expect(entry.total_allocated_amount).toBe(20);
  });

  it("refuses to apply a payment to an unsaved invoice", async () => {
    await expect(
      service.applyToInvoice(
        paymentEntry(),
        new ERPNextSalesInvoice({ customer: "ACME" }),
        undefined
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("records a receive payment for a sales invoice", async () => {
    const invoice = salesInvoice();
    const entry = await service.recordForInvoice(
      invoice,
      { paidFrom: "Debtors", paidTo: "Cash" }
    );

    expect(entry.payment_type).toBe("Receive");
    expect(entry.party_type).toBe("Customer");
    expect(entry.party).toBe("ACME");
    expect(entry.paid_amount).toBe(100);
    expect(entry.references).toHaveLength(1);
    expect(entry.references?.[0].reference_doctype).toBe("Sales Invoice");
    expect(entry.references?.[0].allocated_amount).toBe(100);

    const post = find("POST", "/api/resource/Payment Entry");
    expect(post).toBeTruthy();
    const body = post!.data as Record<string, any>;
    expect(body.payment_type).toBe("Receive");
    expect(body.references).toHaveLength(1);
    expect(body.references[0].reference_name).toBe("SINV-1");
  });

  it("records a pay payment for a purchase invoice", async () => {
    const invoice = purchaseInvoice();
    const entry = await service.recordForInvoice(
      invoice,
      { paidFrom: "Cash", paidTo: "Creditors" }
    );

    expect(entry.payment_type).toBe("Pay");
    expect(entry.party_type).toBe("Supplier");
    expect(entry.references?.[0].reference_doctype).toBe("Purchase Invoice");
  });

  it("rejects a payment without source and target accounts", async () => {
    await expect(
      service.recordForInvoice(
        salesInvoice(),
        { paidFrom: "", paidTo: "" }
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates a payment request linked to the invoice", async () => {
    const invoice = salesInvoice({ outstanding_amount: 60, grand_total: 100 });
    const request = await service.requestForInvoice(
      invoice,
      { currency: "EUR" }
    );

    expect(request.payment_request_type).toBe("Inward");
    expect(request.reference_doctype).toBe("Sales Invoice");
    expect(request.reference_name).toBe("SINV-1");
    expect(request.grand_total).toBe(60);
    expect(request.outstanding_amount).toBe(60);
    expect(request.currency).toBe("EUR");

    const post = find("POST", "/api/resource/Payment Request");
    expect(post).toBeTruthy();
    const body = post!.data as Record<string, any>;
    expect(body.reference_doctype).toBe("Sales Invoice");
    expect(body.reference_name).toBe("SINV-1");
    expect(body.grand_total).toBe(60);
  });

  it("reads the outstanding amount of an invoice", async () => {
    await expect(service.outstandingForInvoice("SINV-1")).resolves.toBe(100);
    const get = find("GET", "/api/resource/Sales Invoice/SINV-1");
    expect(get).toBeTruthy();
  });

  it("falls back to the grand total when the outstanding amount is absent", async () => {
    await expect(
      service.outstandingForInvoice("SINV-FALLBACK")
    ).resolves.toBe(40);
  });

  it("reads a purchase invoice outstanding amount by reference doctype", async () => {
    await expect(
      service.outstandingForInvoice("PINV-1", "Purchase Invoice")
    ).resolves.toBe(75);
    expect(find("GET", "/api/resource/Purchase Invoice/PINV-1")).toBeTruthy();
  });

  it("settles a payment request through a payment entry reference", async () => {
    const request = new ERPNextPaymentRequest({
      name: "PREQ-1",
      payment_request_type: "Inward",
      reference_doctype: "Sales Invoice",
      reference_name: "SINV-1",
      grand_total: 50,
      outstanding_amount: 40,
    });
    const entry = paymentEntry();

    const settled = await service.settleRequest(
      request,
      entry,
      40
    );

    expect(settled.status).toBe("Paid");
    expect(settled.outstanding_amount).toBe(0);
    expect(entry.references).toHaveLength(1);
    expect(entry.references?.[0].payment_request).toBe("PREQ-1");
    expect(entry.references?.[0].allocated_amount).toBe(40);

    const entryPut = find("PUT", "/api/resource/Payment Entry/PE-1");
    expect(entryPut).toBeTruthy();
    const requestPut = find("PUT", "/api/resource/Payment Request/PREQ-1");
    expect(requestPut).toBeTruthy();
    const body = requestPut!.data as Record<string, any>;
    expect(body.status).toBe("Paid");
    expect(body.outstanding_amount).toBe(0);
  });

  it("refuses to settle an unsaved request", async () => {
    await expect(
      service.settleRequest(
        new ERPNextPaymentRequest({
          payment_request_type: "Inward",
          grand_total: 1,
        }),
        paymentEntry(),
        undefined
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
