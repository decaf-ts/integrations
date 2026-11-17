/**
 * @module integrations/tests/unit/erpnext/payments/providers
 * @summary Unit coverage for the provider-specific Stripe, SIBS, GoCardless and
 * Bizum request mapping, SDK transports, credential acquisition and validation.
 * Every HTTP transport is injected, so no real provider is contacted.
 */
import { describe, expect, jest } from "@jest/globals";
import { it } from "@decaf-ts/for-testing";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  BizumPaymentProvider,
  ERPNextPaymentAuthenticationError,
  ERPNextPaymentConfigurationError,
  ERPNextPaymentProviderError,
  GoCardlessPaymentProvider,
  StripePaymentProvider,
  SIBSPaymentProvider,
} from "../../../../src/erpnext";
import type {
  ERPNextPaymentHttpRequest,
  ERPNextPaymentHttpResponse,
  ERPNextPaymentTransport,
  StripeSdkClient,
} from "../../../../src/erpnext";

type Handler = (
  request: ERPNextPaymentHttpRequest
) => ERPNextPaymentHttpResponse | Promise<ERPNextPaymentHttpResponse>;

function transportOf(handler: Handler): {
  transport: ERPNextPaymentTransport;
  calls: ERPNextPaymentHttpRequest[];
} {
  const calls: ERPNextPaymentHttpRequest[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push(request);
      return handler(request);
    },
  };
}

function pathOf(request: ERPNextPaymentHttpRequest): string {
  return new URL(request.url).pathname;
}

describe("StripePaymentProvider REST mapping", () => {
  it("posts a form-encoded PaymentIntent with minor units and metadata", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: {
        id: "pi_1",
        status: "requires_payment_method",
        client_secret: "pi_1_secret",
      },
    }));
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      apiVersion: "2024-06-01",
      customerId: "cus_default",
      transport,
    } as never);

    const result = await provider.createPaymentIntent({
      amount: 12.5,
      currency: "eur",
      reference: "INV-1",
      description: "Order 1",
      metadata: { source: "web" },
    });

    expect(calls[0].url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers).toMatchObject({
      authorization: "Bearer sk_test",
      "stripe-version": "2024-06-01",
      "content-type": "application/x-www-form-urlencoded",
    });
    const body = calls[0].data as URLSearchParams;
    expect(body.get("amount")).toBe("1250");
    expect(body.get("currency")).toBe("eur");
    expect(body.get("customer")).toBe("cus_default");
    expect(body.get("description")).toBe("Order 1");
    expect(body.get("metadata[source]")).toBe("web");
    expect(body.get("metadata[reference]")).toBe("INV-1");
    expect(body.get("automatic_payment_methods[enabled]")).toBe("true");
    expect(result).toMatchObject({
      provider: "stripe",
      id: "pi_1",
      status: "requires_payment_method",
      clientSecret: "pi_1_secret",
    });
  });

  it("prefers an explicit customer over the configured default", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { id: "pi_2" },
    }));
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      customerId: "cus_default",
      transport,
    } as never);
    await provider.createPaymentIntent({
      amount: 1,
      customer: "cus_explicit",
      reference: "INV-2",
    });
    const body = calls[0].data as URLSearchParams;
    expect(body.get("customer")).toBe("cus_explicit");
    expect(body.get("metadata[reference]")).toBe("INV-2");
  });

  it("maps setup-intent, plan and subscription requests over REST", async () => {
    const { transport, calls } = transportOf((request) => {
      const path = pathOf(request);
      if (path === "/v1/setup_intents")
        return { status: 200, data: { id: "seti_1", status: "requires_action" } };
      if (path === "/v1/plans") return { status: 200, data: { id: "plan_1" } };
      if (path === "/v1/subscriptions")
        return { status: 200, data: { id: "sub_1" } };
      return { status: 404, data: {} };
    });
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      productId: "prod_default",
      transport,
    } as never);

    const setup = await provider.createSetupIntent({
      amount: 1,
      customer: "cus_1",
      reference: "INV-3",
    });
    expect(setup.id).toBe("seti_1");
    expect((calls[0].data as URLSearchParams).get("customer")).toBe("cus_1");

    const planId = await provider.ensureProviderPlan({
      planName: "Monthly",
      amount: 9.99,
      interval: "Month",
      intervalCount: 2,
    });
    expect(planId).toBe("plan_1");
    const planBody = calls[1].data as URLSearchParams;
    expect(pathOf(calls[1])).toBe("/v1/plans");
    expect(planBody.get("amount")).toBe("999");
    expect(planBody.get("interval")).toBe("month");
    expect(planBody.get("interval_count")).toBe("2");
    expect(planBody.get("product")).toBe("prod_default");
    expect(planBody.get("nickname")).toBe("Monthly");

    const subscription = await provider.createProviderSubscription({
      providerPlanId: "price_1",
      amount: 9.99,
      currency: "EUR",
      customer: "cus_1",
      reference: "INV-4",
      metadata: { tier: "gold" },
    });
    expect(subscription.id).toBe("sub_1");
    const subscriptionBody = calls[2].data as URLSearchParams;
    expect(subscriptionBody.get("customer")).toBe("cus_1");
    expect(subscriptionBody.get("items[0][plan]")).toBe("price_1");
    expect(subscriptionBody.get("metadata[tier]")).toBe("gold");
    expect(subscriptionBody.get("payment_behavior")).toBe(
      "default_incomplete"
    );
  });

  it("uses product_data when no Stripe product is configured", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { id: "plan_2" },
    }));
    const provider = new StripePaymentProvider();
    await provider.initialize({ secretKey: "sk_test", transport } as never);
    await provider.ensureProviderPlan({
      planName: "Annual",
      amount: 100,
      interval: "Year",
    });
    const body = calls[0].data as URLSearchParams;
    expect(body.has("product")).toBe(false);
    expect(body.get("product_data[name]")).toBe("Annual");
  });

  it("requires a customer for Stripe subscriptions", async () => {
    const provider = new StripePaymentProvider();
    await provider.initialize({ secretKey: "sk_test" } as never);
    await expect(
      provider.createProviderSubscription({
        providerPlanId: "price_1",
        amount: 1,
        currency: "EUR",
      })
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
  });

  it("rejects provider responses without identifiers", async () => {
    const { transport } = transportOf(() => ({ status: 200, data: {} }));
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      customerId: "cus_1",
      transport,
    } as never);
    await expect(
      provider.createPaymentIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
    await expect(
      provider.ensureProviderPlan({ planName: "x", amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
    await expect(
      provider.createProviderSubscription({
        providerPlanId: "price_1",
        amount: 1,
        currency: "EUR",
      })
    ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
  });
});

describe("StripePaymentProvider SDK mapping", () => {
  function sdk(): StripeSdkClient {
    return {
      paymentIntents: {
        create: jest.fn(async () => ({
          id: "pi_sdk",
          status: "requires_action",
          client_secret: "pi_sdk_secret",
        })),
      },
      setupIntents: {
        create: jest.fn(async () => ({
          id: "seti_sdk",
          status: "requires_action",
        })),
      },
      plans: { create: jest.fn(async () => ({ id: "plan_sdk" })) },
      subscriptions: {
        create: jest.fn(async () => ({ id: "sub_sdk" })),
      },
    };
  }

  it("creates PaymentIntents and SetupIntents through the injected SDK", async () => {
    const client = sdk();
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      customerId: "cus_default",
      sdk: client,
    } as never);

    const intent = await provider.createPaymentIntent({
      amount: 15,
      currency: "EUR",
      customer: "cus_1",
      reference: "INV-1",
    });
    expect(intent).toMatchObject({
      id: "pi_sdk",
      status: "requires_action",
      clientSecret: "pi_sdk_secret",
    });
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1500,
        currency: "eur",
        customer: "cus_1",
        metadata: { reference: "INV-1" },
        automatic_payment_methods: { enabled: true },
      })
    );

    const setup = await provider.createSetupIntent({
      amount: 1,
      customer: "cus_1",
      reference: "INV-2",
    });
    expect(setup.id).toBe("seti_sdk");
    expect(client.setupIntents!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        metadata: { reference: "INV-2" },
      })
    );
  });

  it("creates plans and subscriptions through the injected SDK", async () => {
    const client = sdk();
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      customerId: "cus_default",
      productId: "prod_1",
      sdk: client,
    } as never);

    const planId = await provider.ensureProviderPlan({
      planName: "Monthly",
      amount: 20,
      interval: "Month",
      intervalCount: 3,
    });
    expect(planId).toBe("plan_sdk");
    expect(client.plans!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2000,
        currency: "eur",
        interval: "month",
        interval_count: 3,
        product: "prod_1",
        nickname: "Monthly",
      })
    );

    const subscription = await provider.createProviderSubscription({
      providerPlanId: "price_1",
      amount: 20,
      currency: "EUR",
      metadata: { tier: "gold" },
    });
    expect(subscription.id).toBe("sub_sdk");
    expect(client.subscriptions!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_default",
        items: [{ plan: "price_1" }],
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      })
    );
  });
});

describe("SIBSPaymentProvider mapping", () => {
  it("creates a card payment with minor units and provider identifiers", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { paymentId: "pay_1", status: "PAID", paymentUrl: "https://pay" },
    }));
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      terminalId: "terminal-1",
      accessToken: "token-1",
      transport,
    } as never);

    const result = await provider.createPaymentIntent({
      amount: 10,
      reference: "INV-1",
      description: "Order",
    });

    expect(pathOf(calls[0])).toBe("/gateway/v1/payments");
    expect(calls[0].data).toMatchObject({
      merchantId: "merchant-1",
      terminalId: "terminal-1",
      amount: 1000,
      currency: "EUR",
      paymentMethod: "CARD",
      orderId: "INV-1",
      description: "Order",
    });
    expect(result).toMatchObject({
      provider: "sibs",
      id: "pay_1",
      status: "PAID",
      approvalUrl: "https://pay",
    });
  });

  it("requires a phone number for MBWAY payments", async () => {
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
      mbwayEnabled: true,
      transport: transportOf(() => ({ status: 200, data: { paymentId: "p" } }))
        .transport,
    } as never);
    await expect(
      provider.createMBWAYPayment({ amount: 10 })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      provider.createPaymentIntent({ amount: 10, paymentMethod: "MBWAY" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates an MBWAY payment when a phone number is provided", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { paymentId: "pay_mbway" },
    }));
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
      mbwayEnabled: true,
      transport,
    } as never);
    await provider.createMBWAYPayment({
      amount: 5,
      phoneNumber: "600000000",
    });
    expect(calls[0].data).toMatchObject({
      paymentMethod: "MBWAY",
      phoneNumber: "600000000",
    });
  });

  it("acquires and caches an OAuth client-credentials token", async () => {
    const { transport, calls } = transportOf((request) => {
      const path = pathOf(request);
      if (path === "/gateway/v1/oauth/token")
        return {
          status: 200,
          data: { access_token: "issued-token", expires_in: 3600 },
        };
      return { status: 200, data: { paymentId: "pay_1" } };
    });
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      clientId: "client-1",
      clientSecret: "secret-1",
      transport,
    } as never);

    await provider.createPaymentIntent({ amount: 1 });
    await provider.createPaymentIntent({ amount: 2 });

    const tokenCalls = calls.filter(
      (call) => pathOf(call) === "/gateway/v1/oauth/token"
    );
    expect(tokenCalls).toHaveLength(1);
    const tokenBody = tokenCalls[0].data as URLSearchParams;
    expect(tokenBody.get("grant_type")).toBe("client_credentials");
    expect(tokenBody.get("client_id")).toBe("client-1");
    expect(tokenBody.get("client_secret")).toBe("secret-1");
    const paymentCalls = calls.filter(
      (call) => pathOf(call) === "/gateway/v1/payments"
    );
    expect(paymentCalls).toHaveLength(2);
    expect(paymentCalls[0].headers?.authorization).toBe("Bearer issued-token");
  });

  it("rejects a token endpoint failure and a missing token", async () => {
    const failing = new SIBSPaymentProvider();
    await failing.initialize({
      merchantId: "merchant-1",
      clientId: "client-1",
      clientSecret: "secret-1",
      transport: transportOf(() => ({ status: 401, data: {} })).transport,
    } as never);
    await expect(
      failing.createPaymentIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentAuthenticationError);

    const empty = new SIBSPaymentProvider();
    await empty.initialize({
      merchantId: "merchant-1",
      clientId: "client-1",
      clientSecret: "secret-1",
      transport: transportOf(() => ({ status: 200, data: {} })).transport,
    } as never);
    await expect(
      empty.createPaymentIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentAuthenticationError);
  });

  it("maps setup-intent, plan and subscription requests", async () => {
    const { transport, calls } = transportOf((request) => {
      const path = pathOf(request);
      if (path === "/gateway/v1/payment-methods")
        return { status: 200, data: { id: "pm_1" } };
      if (path === "/gateway/v1/subscriptions/plans")
        return { status: 200, data: { planId: "plan_1" } };
      if (path === "/gateway/v1/subscriptions")
        return { status: 200, data: { subscriptionId: "sub_1" } };
      return { status: 404, data: {} };
    });
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
      transport,
    } as never);

    const setup = await provider.createSetupIntent({
      amount: 1,
      customer: "cus_1",
    });
    expect(setup.id).toBe("pm_1");

    const planId = await provider.ensureProviderPlan({
      planName: "Monthly",
      amount: 9.99,
      interval: "Month",
      intervalCount: 2,
    });
    expect(planId).toBe("plan_1");
    expect(calls[1].data).toMatchObject({
      merchantId: "merchant-1",
      name: "Monthly",
      amount: 999,
      currency: "EUR",
      interval: "month",
      intervalCount: 2,
    });

    const subscription = await provider.createProviderSubscription({
      providerPlanId: "plan_1",
      amount: 9.99,
      currency: "EUR",
      customer: "cus_1",
      paymentMethodToken: "tok_1",
      reference: "INV-1",
    });
    expect(subscription.id).toBe("sub_1");
    expect(calls[2].data).toMatchObject({
      merchantId: "merchant-1",
      planId: "plan_1",
      amount: 999,
      currency: "EUR",
      customerId: "cus_1",
      paymentMethodToken: "tok_1",
      externalReference: "INV-1",
    });
  });

  it("rejects payments without a provider identifier", async () => {
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
      transport: transportOf(() => ({ status: 200, data: {} })).transport,
    } as never);
    await expect(
      provider.createPaymentIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
  });
});

describe("GoCardlessPaymentProvider mapping", () => {
  it("requires a mandate for one-off payments", async () => {
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1" } as never);
    await expect(
      provider.createPaymentIntent({ amount: 10 })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates a one-off payment against a mandate", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: {
        payments: {
          id: "PM-1",
          status: "pending",
          authorisation_url: "https://auth",
        },
      },
    }));
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({
      accessToken: "token-1",
      version: "2024-01-01",
      transport,
    } as never);

    const result = await provider.createPaymentIntent({
      amount: 10.5,
      mandateId: "MD-1",
      reference: "INV-1",
      description: "Order",
      metadata: { source: "web" },
    });

    expect(pathOf(calls[0])).toBe("/payments");
    expect(calls[0].headers).toMatchObject({
      authorization: "Bearer token-1",
      "gocardless-version": "2024-01-01",
    });
    expect(calls[0].data).toMatchObject({
      payments: {
        amount: 1050,
        currency: "EUR",
        description: "Order",
        reference: "INV-1",
        metadata: { source: "web" },
        links: { mandate: "MD-1" },
      },
    });
    expect(result).toMatchObject({
      provider: "gocardless",
      id: "PM-1",
      status: "pending",
      approvalUrl: "https://auth",
    });
  });

  it("creates a redirect flow for mandate setup", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: {
        redirect_flows: { id: "RE-1", redirect_url: "https://redirect" },
      },
    }));
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1", transport } as never);

    await expect(
      provider.createSetupIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ValidationError);

    const result = await provider.createSetupIntent({
      amount: 1,
      redirectUrl: "https://return",
      reference: "session-1",
    });
    expect(pathOf(calls[0])).toBe("/redirect_flows");
    expect(calls[0].data).toMatchObject({
      redirect_flows: {
        success_redirect_url: "https://return",
        session_token: "session-1",
      },
    });
    expect(result).toMatchObject({
      id: "RE-1",
      status: "pending",
      approvalUrl: "https://redirect",
    });
  });

  it("maps weekly, monthly and yearly plan intervals and rejects Day", async () => {
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1" } as never);
    await expect(
      provider.ensureProviderPlan({
        planName: "Weekly",
        amount: 10,
        interval: "Week",
      })
    ).resolves.toBe("gocardless:EUR:1000:week:1");
    await expect(
      provider.ensureProviderPlan({
        planName: "Monthly",
        amount: 10,
        interval: "Month",
        intervalCount: 3,
      })
    ).resolves.toBe("gocardless:EUR:1000:month:3");
    await expect(
      provider.ensureProviderPlan({
        planName: "Yearly",
        amount: 10,
        interval: "Year",
      })
    ).resolves.toBe("gocardless:EUR:1000:year:1");
    await expect(
      provider.ensureProviderPlan({
        planName: "Daily",
        amount: 10,
        interval: "Day",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps subscription interval units and rejects Day", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { subscriptions: { id: "SB-1" } },
    }));
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1", transport } as never);

    const base = {
      providerPlanId: "gocardless:EUR:1000:week:2",
      amount: 10,
      currency: "EUR",
      mandateId: "MD-1",
      reference: "ref",
      metadata: { source: "web" },
    };
    await provider.createProviderSubscription({
      ...base,
      interval: "Week",
      intervalCount: 2,
    });
    expect(calls[0].data).toMatchObject({
      subscriptions: {
        amount: 1000,
        currency: "EUR",
        interval_unit: "weekly",
        interval: 2,
        name: "ref",
        metadata: { source: "web" },
        links: { mandate: "MD-1" },
      },
    });

    await provider.createProviderSubscription({
      ...base,
      interval: "Year",
    });
    expect((calls[1].data as any).subscriptions).toMatchObject({
      interval_unit: "yearly",
    });
    expect((calls[1].data as any).subscriptions.interval).toBeUndefined();

    await expect(
      provider.createProviderSubscription({ ...base, interval: "Day" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a mandate and a provider identifier for subscriptions", async () => {
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({
      accessToken: "token-1",
      transport: transportOf(() => ({
        status: 200,
        data: { subscriptions: {} },
      })).transport,
    } as never);
    await expect(
      provider.createProviderSubscription({
        providerPlanId: "plan",
        amount: 1,
        currency: "EUR",
        interval: "Month",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      provider.createProviderSubscription({
        providerPlanId: "plan",
        amount: 1,
        currency: "EUR",
        interval: "Month",
        mandateId: "MD-1",
      })
    ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
  });
});

describe("BizumPaymentProvider mapping", () => {
  it("signs and posts Redsys merchant parameters", async () => {
    const signatureProvider = jest.fn(() => ({
      Ds_SignatureVersion: "HMAC_SHA256_V1",
      Ds_Signature: "sig-1",
    }));
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { Ds_Order: "ORDER123", Ds_Response: "0000" },
    }));
    const provider = new BizumPaymentProvider();
    await provider.initialize({
      merchantCode: "999",
      terminal: "1",
      signatureProvider,
      transport,
    } as never);

    const result = await provider.createPaymentIntent({
      amount: 12.34,
      order: "ORDER123",
      redirectUrl: "https://shop/return",
      phoneNumber: "600000000",
    });

    expect(signatureProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        DS_MERCHANT_AMOUNT: "1234",
        DS_MERCHANT_ORDER: "ORDER123",
        DS_MERCHANT_MERCHANTCODE: "999",
        DS_MERCHANT_TERMINAL: "1",
        DS_MERCHANT_CURRENCY: "978",
        DS_MERCHANT_TRANSACTIONTYPE: "0",
        DS_MERCHANT_GROUP: "Bizum",
        DS_MERCHANT_URLOK: "https://shop/return",
        DS_MERCHANT_CUSTOMER_MOBILE: "600000000",
      })
    );
    expect(pathOf(calls[0])).toBe("/sis/rest/trataPeticionREST");
    expect(calls[0].headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    const body = calls[0].data as URLSearchParams;
    expect(body.get("Ds_SignatureVersion")).toBe("HMAC_SHA256_V1");
    expect(body.get("Ds_Signature")).toBe("sig-1");
    const merchantParameters = JSON.parse(
      Buffer.from(body.get("Ds_MerchantParameters") as string, "base64").toString(
        "utf8"
      )
    );
    expect(merchantParameters).toMatchObject({
      DS_MERCHANT_AMOUNT: "1234",
      DS_MERCHANT_ORDER: "ORDER123",
    });
    expect(result).toMatchObject({
      provider: "bizum",
      id: "ORDER123",
      status: "succeeded",
    });
  });

  it("maps non-EUR currencies and defaults unknown currencies to EUR", async () => {
    const signatureProvider = jest.fn(() => ({ Ds_Signature: "sig-1" }));
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { Ds_Order: "ORDER123", Ds_Response: "0000" },
    }));
    const provider = new BizumPaymentProvider();
    await provider.initialize({
      merchantCode: "999",
      terminal: "1",
      signatureProvider,
      transport,
    } as never);
    await provider.createPaymentIntent({
      amount: 10,
      currency: "GBP",
      order: "ORDER123",
    });
    expect(signatureProvider).toHaveBeenCalledWith(
      expect.objectContaining({ DS_MERCHANT_CURRENCY: "826" })
    );

    await provider.createPaymentIntent({
      amount: 10,
      currency: "XXX",
      order: "ORDER124",
    });
    expect(signatureProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ DS_MERCHANT_CURRENCY: "978" })
    );
    expect(calls).toHaveLength(2);
  });

  it("requires a signature provider and a signed payload", async () => {
    const missing = new BizumPaymentProvider();
    await missing.initialize({
      merchantCode: "999",
      terminal: "1",
      apiKey: "api-key",
    } as never);
    await expect(
      missing.createPaymentIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);

    const failing = new BizumPaymentProvider();
    await failing.initialize({
      merchantCode: "999",
      terminal: "1",
      signatureProvider: () => ({}),
      transport: transportOf(() => ({ status: 200, data: {} })).transport,
    } as never);
    await expect(
      failing.createPaymentIntent({ amount: 1 })
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
  });

  it("maps the tokenization setup request", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { Ds_Order: "ORDER123", Ds_Response: "0000" },
    }));
    const provider = new BizumPaymentProvider();
    await provider.initialize({
      merchantCode: "999",
      terminal: "1",
      signatureProvider: () => ({ Ds_Signature: "sig-1" }),
      transport,
    } as never);
    await provider.createSetupIntent({
      amount: 1,
      order: "ORDER123",
      phoneNumber: "600000000",
    });
    expect(pathOf(calls[0])).toBe("/sis/rest/tokenizacion");
    const body = calls[0].data as URLSearchParams;
    const parameters = JSON.parse(
      Buffer.from(body.get("Ds_MerchantParameters") as string, "base64").toString(
        "utf8"
      )
    );
    expect(parameters).toMatchObject({
      DS_MERCHANT_EXCEP_SCA: "TOKEN",
      DS_MERCHANT_CUSTOMER_MOBILE: "600000000",
    });
  });

  it("maps recurring Bizum subscriptions and validates the token", async () => {
    const signatureProvider = jest.fn(() => ({ Ds_Signature: "sig-1" }));
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { Ds_Order: "REF123", Ds_Response: "0000" },
    }));
    const provider = new BizumPaymentProvider();
    await provider.initialize({
      merchantCode: "999",
      terminal: "1",
      signatureProvider,
      transport,
    } as never);

    const result = await provider.createProviderSubscription({
      providerPlanId: "bizum:plan",
      amount: 10,
      currency: "EUR",
      interval: "Month",
      intervalCount: 2,
      paymentMethodToken: "tok-1",
      reference: "REF123",
    });

    expect(signatureProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        DS_MERCHANT_TRANSACTIONTYPE: "R",
        DS_MERCHANT_EXCEP_SCA: "MIT",
        DS_MERCHANT_IDENTIFIER: "tok-1",
        DS_MERCHANT_IDENTIFIER_TYPE: "1",
        DS_MERCHANT_PERIODICITY: "Month",
        DS_MERCHANT_PERIODICITY_COUNT: "2",
        DS_MERCHANT_AMOUNT: "1000",
      })
    );
    expect(result.id).toBe("REF123");

    await expect(
      provider.createProviderSubscription({
        providerPlanId: "bizum:plan",
        amount: 10,
        currency: "EUR",
        interval: "Month",
        reference: "REF123",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await provider.createProviderSubscription({
      providerPlanId: "bizum:plan",
      amount: 10,
      currency: "EUR",
      interval: "Month",
      mandateId: "mandate-1",
      reference: "REF124",
    });
    expect(signatureProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ DS_MERCHANT_IDENTIFIER: "mandate-1" })
    );
    expect(calls).toHaveLength(2);
  });

  it("produces a deterministic local plan identifier", async () => {
    const provider = new BizumPaymentProvider();
    await provider.initialize({
      merchantCode: "999",
      terminal: "1",
      apiKey: "api-key",
    } as never);
    await expect(
      provider.ensureProviderPlan({
        planName: "Monthly",
        amount: 12.34,
        interval: "Month",
        intervalCount: 2,
      })
    ).resolves.toBe("bizum:999:EUR:1234:month:2");
  });
});
