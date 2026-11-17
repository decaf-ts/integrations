/**
 * @module integrations/tests/unit/erpnext/payments/webhooks
 * @summary Unit coverage for payment webhook verification and per-provider
 * event/status/action normalization for Stripe, SIBS, GoCardless and Bizum.
 */
import { describe, expect, jest } from "@jest/globals";
import { it } from "@decaf-ts/for-testing";
import {
  BizumPaymentProvider,
  ERPNextPaymentUnsupportedError,
  ERPNextPaymentWebhookError,
  GoCardlessPaymentProvider,
  StripePaymentProvider,
  SIBSPaymentProvider,
} from "../../../../src/erpnext";
import type {
  ERPNextPaymentProvider,
  ERPNextPaymentWebhookAction,
  ERPNextPaymentWebhookStatus,
  StripePaymentProviderConfig,
} from "../../../../src/erpnext";

async function stripeProvider(
  config: Partial<StripePaymentProviderConfig> = {}
): Promise<StripePaymentProvider> {
  const provider = new StripePaymentProvider();
  await provider.initialize({ secretKey: "sk_test", ...config } as never);
  return provider;
}

describe("handleWebhook verification", () => {
  const payload = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", amount: 1000, currency: "eur" } },
  };

  it("accepts a payload when the verifier succeeds", async () => {
    const verifier = jest.fn(async () => true);
    const provider = await stripeProvider({ webhookVerifier: verifier });
    const events = await provider.handleWebhook(payload, {
      signature: "good-signature",
    });
    expect(verifier).toHaveBeenCalledWith(payload, "good-signature");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "stripe",
      type: "payment_intent.succeeded",
      status: "succeeded",
      actions: ["mark-paid"],
    });
  });

  it("rejects a payload when the verifier fails", async () => {
    const provider = await stripeProvider({ webhookVerifier: () => false });
    await expect(
      provider.handleWebhook(payload, { signature: "bad-signature" })
    ).rejects.toBeInstanceOf(ERPNextPaymentWebhookError);
  });

  it("requires a verifier when a signature is supplied", async () => {
    const provider = await stripeProvider();
    await expect(
      provider.handleWebhook(payload, { signature: "signature" })
    ).rejects.toBeInstanceOf(ERPNextPaymentUnsupportedError);
  });

  it("rejects an unsigned payload when webhookSecret is configured", async () => {
    const verifier = jest.fn(async () => true);
    const provider = await stripeProvider({
      webhookSecret: "whsec_test",
      webhookVerifier: verifier,
    });
    await expect(provider.handleWebhook(payload)).rejects.toBeInstanceOf(
      ERPNextPaymentWebhookError
    );
    expect(verifier).not.toHaveBeenCalled();
  });

  it("processes an unsigned payload when no webhookSecret is configured", async () => {
    const verifier = jest.fn(async () => true);
    const provider = await stripeProvider({ webhookVerifier: verifier });
    const events = await provider.handleWebhook(payload);
    expect(events).toHaveLength(1);
    expect(events[0].actions).toEqual(["mark-paid"]);
    expect(verifier).not.toHaveBeenCalled();
  });

  it("accepts a signed payload when webhookSecret is configured", async () => {
    const verifier = jest.fn(async () => true);
    const provider = await stripeProvider({
      webhookSecret: "whsec_test",
      webhookVerifier: verifier,
    });
    const events = await provider.handleWebhook(payload, { signature: "sig" });
    expect(verifier).toHaveBeenCalledWith(payload, "sig");
    expect(events).toHaveLength(1);
    expect(events[0].actions).toEqual(["mark-paid"]);
  });

  it("wraps a throwing verifier in ERPNextPaymentWebhookError", async () => {
    const provider = await stripeProvider({
      webhookSecret: "whsec_test",
      webhookVerifier: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      provider.handleWebhook(payload, { signature: "sig" })
    ).rejects.toBeInstanceOf(ERPNextPaymentWebhookError);
  });

  it("parses an unsigned payload without a verifier", async () => {
    const provider = await stripeProvider();
    const events = await provider.handleWebhook(payload);
    expect(events[0].actions).toEqual(["mark-paid"]);
  });

  it("rejects payloads without a recognised event", async () => {
    const stripe = await stripeProvider();
    await expect(stripe.handleWebhook({})).rejects.toBeInstanceOf(
      ERPNextPaymentWebhookError
    );

    const gocardless = new GoCardlessPaymentProvider();
    await gocardless.initialize({ accessToken: "token-1" } as never);
    await expect(
      gocardless.handleWebhook({ events: [] })
    ).rejects.toBeInstanceOf(ERPNextPaymentWebhookError);
  });

  it("rejects webhook handling before initialization", async () => {
    await expect(
      new StripePaymentProvider().handleWebhook(payload)
    ).rejects.toBeInstanceOf(Error);
  });
});

interface ExpectedEvent {
  status: ERPNextPaymentWebhookStatus;
  actions: ERPNextPaymentWebhookAction[];
  paymentId?: string;
  subscriptionId?: string;
  amount?: number;
  currency?: string;
}

function assertEvent(
  event: {
    status: ERPNextPaymentWebhookStatus;
    actions: ERPNextPaymentWebhookAction[];
    paymentId?: string;
    subscriptionId?: string;
    amount?: number;
    currency?: string;
  },
  expected: ExpectedEvent
) {
  expect(event.status).toBe(expected.status);
  expect(event.actions).toEqual(expected.actions);
  if (expected.paymentId)
    expect(event.paymentId).toBe(expected.paymentId);
  else expect(event.paymentId).toBeUndefined();
  if (expected.subscriptionId)
    expect(event.subscriptionId).toBe(expected.subscriptionId);
  else expect(event.subscriptionId).toBeUndefined();
  if (typeof expected.amount === "number")
    expect(event.amount).toBe(expected.amount);
  else expect(event.amount).toBeUndefined();
  if (expected.currency) expect(event.currency).toBe(expected.currency);
}

describe("StripePaymentProvider.parseWebhook", () => {
  it("normalizes payment, invoice and subscription events", async () => {
    const provider = await stripeProvider();
    const cases: Array<
      [Record<string, any>, string, ExpectedEvent]
    > = [
      [
        {
          id: "evt_pi_ok",
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_1", amount: 2500, currency: "eur" } },
        },
        "payment_intent.succeeded",
        {
          status: "succeeded",
          actions: ["mark-paid"],
          paymentId: "pi_1",
          amount: 25,
          currency: "EUR",
        },
      ],
      [
        {
          type: "payment_intent.payment_failed",
          data: { object: { id: "pi_2", amount: 1000, currency: "eur" } },
        },
        "payment_intent.payment_failed",
        {
          status: "failed",
          actions: ["mark-failed"],
          paymentId: "pi_2",
          amount: 10,
          currency: "EUR",
        },
      ],
      [
        {
          type: "payment_intent.processing",
          data: { object: { id: "pi_3" } },
        },
        "payment_intent.processing",
        { status: "pending", actions: ["ignore"], paymentId: "pi_3" },
      ],
      [
        {
          type: "invoice.paid",
          data: { object: { id: "in_1", amount_paid: 3000, currency: "usd" } },
        },
        "invoice.paid",
        {
          status: "succeeded",
          actions: ["mark-paid"],
          paymentId: "in_1",
          amount: 30,
          currency: "USD",
        },
      ],
      [
        {
          type: "invoice.payment_failed",
          data: { object: { id: "in_2", amount_paid: 500 } },
        },
        "invoice.payment_failed",
        {
          status: "failed",
          actions: ["mark-failed"],
          paymentId: "in_2",
          amount: 5,
        },
      ],
      [
        {
          type: "invoice.payment_action_required",
          data: { object: { id: "in_3" } },
        },
        "invoice.payment_action_required",
        { status: "pending", actions: ["ignore"], paymentId: "in_3" },
      ],
      [
        {
          type: "setup_intent.succeeded",
          data: { object: { id: "seti_1" } },
        },
        "setup_intent.succeeded",
        { status: "succeeded", actions: ["ignore"] },
      ],
      [
        {
          type: "customer.subscription.created",
          data: { object: { id: "sub_1" } },
        },
        "customer.subscription.created",
        {
          status: "active",
          actions: ["activate-subscription"],
          subscriptionId: "sub_1",
        },
      ],
      [
        {
          type: "customer.subscription.updated",
          data: { object: { id: "sub_2", subscription: "sub_ref" } },
        },
        "customer.subscription.updated",
        {
          status: "active",
          actions: ["activate-subscription"],
          subscriptionId: "sub_ref",
        },
      ],
      [
        {
          type: "customer.subscription.deleted",
          data: { object: { id: "sub_3" } },
        },
        "customer.subscription.deleted",
        {
          status: "cancelled",
          actions: ["cancel-subscription"],
          subscriptionId: "sub_3",
        },
      ],
      [
        { type: "unhandled.event", data: { object: { id: "x" } } },
        "unhandled.event",
        { status: "unknown", actions: ["ignore"] },
      ],
    ];

    for (const [payload, expectedType, expected] of cases) {
      const events = provider.parseWebhook(payload);
      expect(events).toHaveLength(1);
      expect(events[0].provider).toBe("stripe");
      expect(events[0].type).toBe(expectedType);
      expect(events[0].raw).toBe(payload);
      assertEvent(events[0], expected);
    }
  });

  it("ignores payloads without an event type", async () => {
    const provider = await stripeProvider();
    expect(provider.parseWebhook({})).toEqual([]);
    expect(provider.parseWebhook({ data: { object: {} } })).toEqual([]);
  });
});

describe("SIBSPaymentProvider.parseWebhook", () => {
  it("normalizes an array of SIBS events", async () => {
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
    } as never);
    const events = provider.parseWebhook([
      {
        id: "e1",
        type: "payment.succeeded",
        paymentId: "pay_1",
        amount: 1000,
        currency: "eur",
      },
      {
        eventType: "payment.failed",
        transactionId: "pay_2",
      },
      { type: "payment.pending", paymentId: "pay_3" },
      { type: "payment.unknown_reference", id: "unknown-1" },
      { type: "subscription.created", subscriptionId: "sub_1" },
      { type: "subscription.active", subscriptionId: "sub_2" },
      { type: "subscription.cancelled", subscriptionId: "sub_3" },
      { event: "subscription.canceled", subscriptionId: "sub_4" },
      { id: "no-type" },
      null,
      "not-an-object",
    ]);

    expect(events).toHaveLength(8);
    assertEvent(events[0], {
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "pay_1",
      amount: 10,
      currency: "EUR",
    });
    assertEvent(events[1], {
      status: "failed",
      actions: ["mark-failed"],
      paymentId: "pay_2",
    });
    assertEvent(events[2], {
      status: "pending",
      actions: ["ignore"],
      paymentId: "pay_3",
    });
    assertEvent(events[3], {
      status: "unknown",
      actions: ["ignore"],
      paymentId: "unknown-1",
    });
    assertEvent(events[4], {
      status: "active",
      actions: ["activate-subscription"],
      subscriptionId: "sub_1",
    });
    assertEvent(events[5], {
      status: "active",
      actions: ["activate-subscription"],
      subscriptionId: "sub_2",
    });
    assertEvent(events[6], {
      status: "cancelled",
      actions: ["cancel-subscription"],
      subscriptionId: "sub_3",
    });
    assertEvent(events[7], {
      status: "cancelled",
      actions: ["cancel-subscription"],
      subscriptionId: "sub_4",
    });
  });

  it("accepts a single SIBS event object", async () => {
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
    } as never);
    const events = provider.parseWebhook({
      type: "payment.completed",
      id: "tx-1",
      amount: 250,
      currency: "eur",
    });
    expect(events).toHaveLength(1);
    assertEvent(events[0], {
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "tx-1",
      amount: 2.5,
      currency: "EUR",
    });
  });
});

describe("GoCardlessPaymentProvider.parseWebhook", () => {
  async function provider(): Promise<GoCardlessPaymentProvider> {
    const instance = new GoCardlessPaymentProvider();
    await instance.initialize({ accessToken: "token-1" } as never);
    return instance;
  }

  it("normalizes payment and subscription events from the envelope", async () => {
    const instance = await provider();
    const events = instance.parseWebhook({
      events: [
        {
          id: "ev1",
          resource_type: "payments",
          action: "paid_out",
          links: { payment: "PM-1" },
          details: { amount: 2500, currency: "eur" },
        },
        {
          resource_type: "payments",
          action: "failed",
          links: { payment: "PM-2" },
        },
        {
          resource_type: "payments",
          action: "created",
          links: { payment: "PM-3" },
        },
        {
          resource_type: "subscriptions",
          action: "created",
          links: { subscription: "SB-1" },
        },
        {
          resource_type: "subscriptions",
          action: "cancelled",
          links: { subscription: "SB-2" },
        },
        { resource_type: "subscriptions", action: "paused" },
        { resource_type: "mandates", action: "created" },
        {},
        null,
      ],
    });

    expect(events).toHaveLength(7);
    expect(events[0]).toMatchObject({
      provider: "gocardless",
      id: "ev1",
      type: "payments.paid_out",
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "PM-1",
      amount: 25,
      currency: "EUR",
    });
    assertEvent(events[1], {
      status: "failed",
      actions: ["mark-failed"],
      paymentId: "PM-2",
    });
    assertEvent(events[2], {
      status: "pending",
      actions: ["ignore"],
      paymentId: "PM-3",
    });
    assertEvent(events[3], {
      status: "active",
      actions: ["activate-subscription"],
      subscriptionId: "SB-1",
    });
    assertEvent(events[4], {
      status: "cancelled",
      actions: ["cancel-subscription"],
      subscriptionId: "SB-2",
    });
    assertEvent(events[5], { status: "pending", actions: ["ignore"] });
    assertEvent(events[6], { status: "unknown", actions: ["ignore"] });
  });

  it("accepts a raw array of GoCardless events", async () => {
    const instance = await provider();
    const events = instance.parseWebhook([
      {
        resource_type: "payments",
        action: "confirmed",
        links: { payment: "PM-9" },
      },
    ]);
    expect(events).toHaveLength(1);
    assertEvent(events[0], {
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "PM-9",
    });
    expect(instance.parseWebhook({})).toEqual([]);
  });
});

describe("BizumPaymentProvider.parseWebhook", () => {
  async function provider(): Promise<BizumPaymentProvider> {
    const instance = new BizumPaymentProvider();
    await instance.initialize({
      merchantCode: "999",
      terminal: "1",
      apiKey: "api-key",
    } as never);
    return instance;
  }

  it("normalizes Redsys response codes for payments", async () => {
    const instance = await provider();
    const events = instance.parseWebhook([
      {
        Ds_Order: "O1",
        Ds_Response: "0000",
        Ds_Amount: 1234,
        Ds_Currency: "978",
      },
      {
        Ds_Order: "O2",
        Ds_Response: "0190",
        Ds_Amount: "500",
        Ds_Currency: "978",
      },
      {
        paymentId: "O3",
        responseCode: "0",
        amount: 100,
        currency: "gbp",
      },
      {
        orderId: "O4",
        code: "9999",
        amount: 100,
        currency: "GBP",
      },
    ]);

    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      provider: "bizum",
      type: "payment",
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "O1",
      amount: 12.34,
      currency: "EUR",
    });
    expect(events[1]).toMatchObject({
      status: "failed",
      actions: ["mark-failed"],
      paymentId: "O2",
      amount: 5,
      currency: "EUR",
    });
    expect(events[2]).toMatchObject({
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "O3",
      amount: 1,
      currency: "GBP",
    });
    expect(events[3]).toMatchObject({
      status: "failed",
      actions: ["mark-failed"],
      paymentId: "O4",
    });
  });

  it("normalizes subscription activation and cancellation", async () => {
    const instance = await provider();
    const events = instance.parseWebhook([
      { type: "subscription.created", subscriptionId: "SUB-1" },
      { type: "subscription.cancel", subscriptionId: "SUB-2" },
    ]);
    assertEvent(events[0], {
      status: "active",
      actions: ["activate-subscription"],
      subscriptionId: "SUB-1",
    });
    assertEvent(events[1], {
      status: "cancelled",
      actions: ["cancel-subscription"],
      subscriptionId: "SUB-2",
    });
  });

  it("accepts a single Bizum notification object", async () => {
    const instance = await provider();
    const events = instance.parseWebhook({
      Ds_Order: "O1",
      Ds_Response: "0000",
      Ds_Amount: 2500,
      Ds_Currency: "978",
      Ds_Response_Description: "Authorised",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("Authorised");
    expect(events[0]).toMatchObject({
      status: "succeeded",
      actions: ["mark-paid"],
      paymentId: "O1",
      amount: 25,
      currency: "EUR",
    });
  });

  it("ignores payloads without any recognised provider code", async () => {
    const instance = await provider();
    expect(instance.parseWebhook({})).toEqual([]);
    await expect(instance.handleWebhook({})).rejects.toBeInstanceOf(
      ERPNextPaymentWebhookError
    );
  });

  it("ignores entries that only carry an order reference", async () => {
    const instance = await provider();
    expect(instance.parseWebhook({ Ds_Order: "O1" })).toEqual([]);
    expect(
      instance.parseWebhook([{ Ds_Order: "O1" }, { Ds_Order: "O2" }])
    ).toEqual([]);
  });

  it("still maps explicit success and failure response codes", async () => {
    const instance = await provider();
    const success = instance.parseWebhook({ Ds_Response: "0000" });
    expect(success).toHaveLength(1);
    assertEvent(success[0], { status: "succeeded", actions: ["mark-paid"] });

    const failure = instance.parseWebhook({ Ds_Response: "0190" });
    expect(failure).toHaveLength(1);
    assertEvent(failure[0], { status: "failed", actions: ["mark-failed"] });
  });
});

describe("webhook provider identity", () => {
  it("stamps every parsed event with its provider key", async () => {
    const instances: ERPNextPaymentProvider[] = [
      await stripeProvider(),
    ];
    for (const provider of instances) {
      const events = provider.parseWebhook({
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_1" } },
      });
      expect(events[0]?.provider).toBe(provider.provider);
    }
  });
});
