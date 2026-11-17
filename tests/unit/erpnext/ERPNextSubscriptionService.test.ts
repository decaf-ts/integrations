/**
 * @module integrations/tests/unit/erpnext/ERPNextSubscriptionService
 * @summary Unit coverage for the ERPNext subscription model service. The adapter
 * transport is injected and the Frappe resource envelopes are mocked, so no
 * ERPNext site, network or credentials are required.
 */
import { it } from "@decaf-ts/for-testing";
import { beforeAll, beforeEach, describe, expect } from "@jest/globals";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextAdapter,
  ERPNextFlavour,
  ERPNextSubscription,
  ERPNextSubscriptionPlanDetail,
  ERPNextSubscriptionService,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

const planDocuments: Record<string, any> = {
  "PLAN-1": {
    name: "PLAN-1",
    plan_name: "Starter",
    currency: "USD",
    item: "ITEM-1",
    price_determination: "Fixed Rate",
    cost: 50,
    billing_interval: "Month",
    billing_interval_count: 1,
  },
  "PLAN-2": {
    name: "PLAN-2",
    plan_name: "Annual",
    currency: "USD",
    item: "ITEM-2",
    price_determination: "Fixed Rate",
    cost: 500,
    billing_interval: "Year",
    billing_interval_count: 1,
  },
};

const subscriptionDocuments: Record<string, any> = {
  "SUB-1": {
    name: "SUB-1",
    party_type: "Customer",
    party: "ACME",
    company: "ACME",
    generate_invoice_at: "End of the current subscription period",
    plans: [{ plan: "PLAN-1", qty: 2 }],
    status: "Trialling",
  },
};

const calls: ERPNextHttpRequest[] = [];

function route(request: ERPNextHttpRequest): ERPNextHttpResponse {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const method = request.method;
  const body = (request.data ?? {}) as Record<string, any>;

  if (method === "GET" && path.startsWith("/api/resource/Subscription Plan/")) {
    const name = decodeURIComponent(path.split("/").pop() as string);
    const document = planDocuments[name];
    return document
      ? { status: 200, data: { data: document } }
      : { status: 404, data: { exc_type: "DoesNotExistError" } };
  }

  if (method === "GET" && path.startsWith("/api/resource/Subscription/")) {
    const name = decodeURIComponent(path.split("/").pop() as string);
    const document = subscriptionDocuments[name];
    return document
      ? { status: 200, data: { data: document } }
      : { status: 404, data: { exc_type: "DoesNotExistError" } };
  }

  if (method === "PUT" && path.startsWith("/api/resource/Subscription/")) {
    return {
      status: 200,
      data: {
        data: {
          name: decodeURIComponent(path.split("/").pop() as string),
          ...body,
        },
      },
    };
  }

  if (method === "POST" && path === "/api/resource/Sales Invoice") {
    return {
      status: 200,
      data: { data: { name: body.name ?? "SINV-NEW", ...body } },
    };
  }

  if (method === "POST" && path === "/api/method/frappe.client.submit") {
    return { status: 200, data: { message: { name: body.doc?.name } } };
  }

  return { status: 404, data: { exc_type: "DoesNotExistError" } };
}

const transport: ERPNextTransport = async (request) => {
  calls.push(request);
  return route(request);
};

function subscription(
  data: Partial<ERPNextSubscription> = {}
): ERPNextSubscription {
  return new ERPNextSubscription({
    name: "SUB-1",
    party_type: "Customer",
    party: "ACME",
    company: "ACME",
    generate_invoice_at: "End of the current subscription period",
    plans: [new ERPNextSubscriptionPlanDetail({ plan: "PLAN-1", qty: 2 })],
    ...data,
  });
}

function last(method: string) {
  return [...calls].reverse().find((call) => call.method === method);
}

function pathOf(call: ERPNextHttpRequest): string {
  return decodeURIComponent(new URL(call.url).pathname);
}

describe("ERPNextSubscriptionService", () => {
  let service: ERPNextSubscriptionService;

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
    service = new ERPNextSubscriptionService();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("activates a subscription and defaults its start date", async () => {
    const model = subscription();
    const activated = await service.activate(model);

    expect(model.status).toBe("Active");
    expect(model.start_date).toBeInstanceOf(Date);
    expect(activated.status).toBe("Active");

    const put = last("PUT");
    expect(put).toBeTruthy();
    expect(pathOf(put!)).toBe("/api/resource/Subscription/SUB-1");
    expect((put!.data as Record<string, any>).status).toBe("Active");
  });

  it("keeps an existing start date when activating", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const model = subscription({ start_date: start });
    await service.activate(model);
    expect(model.start_date?.getTime()).toBe(start.getTime());
  });

  it("sets the trial start when only the trial end is provided", async () => {
    const model = subscription({
      trial_period_end: new Date("2026-02-01T00:00:00.000Z"),
    });
    await service.activate(model);
    expect(model.trial_period_start?.getTime()).toBe(
      model.start_date?.getTime()
    );
  });

  it("flags cancellation at period end without cancelling", async () => {
    const model = subscription({ status: "Active" });
    await service.cancel(model, { atPeriodEnd: true });

    expect(model.cancel_at_period_end).toBe(true);
    expect(model.status).toBe("Active");
    expect(model.end_date).toBeUndefined();
    expect(model.cancelation_date).toBeInstanceOf(Date);
  });

  it("cancels immediately and records the end date", async () => {
    const model = subscription({ status: "Active" });
    const at = new Date("2026-06-30T00:00:00.000Z");
    await service.cancel(model, { date: at });

    expect(model.status).toBe("Cancelled");
    expect(model.cancel_at_period_end).toBe(false);
    expect(model.end_date?.getTime()).toBe(at.getTime());
  });

  it("generates a sales invoice from the subscription plans", async () => {
    const model = subscription();
    const invoice = await service.generateInvoice(model, {
      postingDate: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(invoice.items).toHaveLength(1);
    expect(invoice.items?.[0].item_code).toBe("ITEM-1");
    expect(invoice.items?.[0].qty).toBe(2);
    expect(invoice.items?.[0].rate).toBe(50);
    expect(invoice.items?.[0].amount).toBe(100);

    const read = calls.find(
      (call) =>
        call.method === "GET" &&
        pathOf(call) === "/api/resource/Subscription Plan/PLAN-1"
    );
    expect(read).toBeTruthy();

    const post = calls.find(
      (call) =>
        call.method === "POST" &&
        pathOf(call) === "/api/resource/Sales Invoice"
    );
    expect(post).toBeTruthy();
    const body = post!.data as Record<string, any>;
    expect(body.customer).toBe("ACME");
    expect(body.company).toBe("ACME");
    expect(body.items[0].amount).toBe(100);
  });

  it("submits the generated sales invoice when requested", async () => {
    const model = subscription();
    await service.generateInvoice(model, { submit: true });

    const submit = calls.find(
      (call) =>
        call.method === "POST" &&
        pathOf(call) === "/api/method/frappe.client.submit"
    );
    expect(submit).toBeTruthy();
  });

  it("refuses to invoice a subscription without a company", async () => {
    const model = subscription({ company: undefined } as never);
    await expect(service.generateInvoice(model)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("refuses to invoice a subscription without plans", async () => {
    const model = subscription({ plans: [] } as never);
    await expect(service.generateInvoice(model)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("advances the billing period from the first plan", async () => {
    const model = subscription({
      current_invoice_end: new Date("2026-01-15T00:00:00.000Z"),
    });
    await service.advanceBillingPeriod(model);

    expect(model.current_invoice_start?.toISOString()).toBe(
      "2026-01-15T00:00:00.000Z"
    );
    expect(model.current_invoice_end?.toISOString()).toBe(
      "2026-02-15T00:00:00.000Z"
    );

    const put = last("PUT");
    expect(pathOf(put!)).toBe("/api/resource/Subscription/SUB-1");
  });

  it("refuses to advance the billing period without plans", async () => {
    const model = subscription({ plans: [] } as never);
    await expect(service.advanceBillingPeriod(model)).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});
