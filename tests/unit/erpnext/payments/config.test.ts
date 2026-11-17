/**
 * @module integrations/tests/unit/erpnext/payments/config
 * @summary Unit coverage for ERPNext payment configuration, provider selection,
 * gateway registration, payment-request creation, recurring plan/subscription
 * bookkeeping and HTTP failure normalization across every provider.
 */
import { afterEach, beforeEach, describe, expect } from "@jest/globals";
import { ConnectionError } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  BizumPaymentProvider,
  ERPNextPaymentAuthenticationError,
  ERPNextPaymentConfigurationError,
  ERPNextPaymentConflictError,
  ERPNextPaymentForbiddenError,
  ERPNextPaymentNotFoundError,
  ERPNextPaymentProviderError,
  GoCardlessPaymentProvider,
  StripePaymentProvider,
  SIBSPaymentProvider,
  createERPNextPaymentIntegration,
  createERPNextPaymentProvider,
  resolveERPNextPaymentProviderKey,
} from "../../../../src/erpnext";
import type {
  ERPNextPaymentConfig,
  ERPNextPaymentHttpRequest,
  ERPNextPaymentHttpResponse,
  ERPNextPaymentProvider,
  ERPNextPaymentProviderKey,
  ERPNextPaymentTarget,
  ERPNextPaymentTransport,
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

interface TargetCalls {
  list: Array<{ doctype: string; options?: Record<string, unknown> }>;
  fetched: Array<{ doctype: string; name: string }>;
  created: Array<{ doctype: string; data: Record<string, any> }>;
  updated: Array<{ doctype: string; name: string; data: Record<string, any> }>;
}

interface TargetOptions {
  list?: Record<string, any>[];
  get?: Record<string, any>;
  create?: Record<string, any>;
  update?: Record<string, any>;
}

function targetOf(options: TargetOptions = {}): {
  target: ERPNextPaymentTarget;
  calls: TargetCalls;
} {
  const calls: TargetCalls = {
    list: [],
    fetched: [],
    created: [],
    updated: [],
  };
  const target: ERPNextPaymentTarget = {
    listDocs: async (doctype, opts) => {
      calls.list.push({ doctype, options: opts });
      return options.list ?? [];
    },
    getDoc: async (doctype, name) => {
      calls.fetched.push({ doctype, name });
      return options.get ?? { name };
    },
    createDoc: async (doctype, data) => {
      calls.created.push({ doctype, data });
      return { name: "NEW-1", ...data, ...(options.create ?? {}) };
    },
    updateDoc: async (doctype, name, data) => {
      calls.updated.push({ doctype, name, data });
      return { name, ...data, ...(options.update ?? {}) };
    },
  };
  return { target, calls };
}

function clearPaymentEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("ERPNEXT__PAYMENTS")) delete process.env[key];
  }
}

async function initializedProvider(
  provider: ERPNextPaymentProviderKey,
  transport: ERPNextPaymentTransport
): Promise<ERPNextPaymentProvider> {
  switch (provider) {
    case "stripe": {
      const instance = new StripePaymentProvider();
      await instance.initialize({ secretKey: "sk_test", transport } as never);
      return instance;
    }
    case "sibs": {
      const instance = new SIBSPaymentProvider();
      await instance.initialize({
        merchantId: "merchant-1",
        accessToken: "token-1",
        transport,
      } as never);
      return instance;
    }
    case "gocardless": {
      const instance = new GoCardlessPaymentProvider();
      await instance.initialize({ accessToken: "token-1", transport } as never);
      return instance;
    }
    case "bizum": {
      const instance = new BizumPaymentProvider();
      await instance.initialize({
        merchantCode: "merchant-1",
        terminal: "1",
        apiKey: "api-key",
        signatureProvider: () => ({ Ds_Signature: "signature" }),
        transport,
      } as never);
      return instance;
    }
  }
}

function intentInput(provider: ERPNextPaymentProviderKey) {
  return provider === "gocardless"
    ? { amount: 10, mandateId: "MD-1" }
    : { amount: 10 };
}

beforeEach(clearPaymentEnvironment);
afterEach(clearPaymentEnvironment);

describe("ERPNext payment provider selection", () => {
  it("resolves an explicit provider key over the environment", () => {
    process.env.ERPNEXT__PAYMENTS__PROVIDER = "sibs";
    expect(resolveERPNextPaymentProviderKey()).toBe("sibs");
    expect(resolveERPNextPaymentProviderKey("stripe")).toBe("stripe");
  });

  it("rejects unknown provider keys with a decaf ValidationError", () => {
    expect(() => resolveERPNextPaymentProviderKey("paypal")).toThrow(
      ValidationError
    );
    expect(() => resolveERPNextPaymentProviderKey()).toThrow(ValidationError);
  });

  it("builds the matching provider class for every key", () => {
    const configs: Array<[ERPNextPaymentConfig, unknown]> = [
      [{ provider: "stripe", secretKey: "sk_test" }, StripePaymentProvider],
      [
        { provider: "sibs", merchantId: "merchant-1", accessToken: "token-1" },
        SIBSPaymentProvider,
      ],
      [
        { provider: "gocardless", accessToken: "token-1" },
        GoCardlessPaymentProvider,
      ],
      [
        {
          provider: "bizum",
          merchantCode: "merchant-1",
          terminal: "1",
          apiKey: "api-key",
        },
        BizumPaymentProvider,
      ],
    ];
    for (const [config, klass] of configs) {
      const provider = createERPNextPaymentProvider(config);
      expect(provider).toBeInstanceOf(klass as never);
      expect(provider.provider).toBe(config.provider);
    }
  });

  it("rejects an unsupported provider config", () => {
    expect(() =>
      createERPNextPaymentProvider({ provider: "paypal" } as never)
    ).toThrow(ERPNextPaymentConfigurationError);
  });

  it("initializes a provider through the async factory", async () => {
    for (const config of [
      { provider: "stripe", secretKey: "sk_test" },
      { provider: "sibs", merchantId: "merchant-1", accessToken: "token-1" },
      { provider: "gocardless", accessToken: "token-1" },
      {
        provider: "bizum",
        merchantCode: "merchant-1",
        terminal: "1",
        apiKey: "api-key",
      },
    ] as ERPNextPaymentConfig[]) {
      const provider = await createERPNextPaymentIntegration(config);
      expect(provider.paymentConfig.provider).toBe(config.provider);
      expect(provider.paymentConfig.currency).toBe("EUR");
      expect(provider.paymentConfig.sandbox).toBe(true);
      expect(provider.paymentConfig.timeout).toBe(30000);
    }
  });
});

describe("ERPNext payment configuration merging", () => {
  it("lets an explicit config override the environment slice", async () => {
    process.env.ERPNEXT__PAYMENTS__STRIPE__SECRET_KEY = "sk_env";
    process.env.ERPNEXT__PAYMENTS__STRIPE__PUBLISHABLE_KEY = "pk_env";
    const provider = new StripePaymentProvider();
    await provider.initialize({ secretKey: "sk_explicit" } as never);
    expect(provider.paymentConfig.secretKey).toBe("sk_explicit");
    expect(provider.paymentConfig.publishableKey).toBe("pk_env");
  });

  it("falls back to environment values when the config omits them", async () => {
    process.env.ERPNEXT__PAYMENTS__STRIPE__SECRET_KEY = "sk_env";
    const provider = new StripePaymentProvider();
    await provider.initialize({} as never);
    expect(provider.paymentConfig.secretKey).toBe("sk_env");
  });

  it("honours environment currency and sandbox overrides", async () => {
    process.env.ERPNEXT__PAYMENTS__CURRENCY = "gbp";
    process.env.ERPNEXT__PAYMENTS__SANDBOX = "false";
    const provider = await createERPNextPaymentIntegration({
      provider: "stripe",
      secretKey: "sk_test",
    });
    expect(provider.paymentConfig.currency).toBe("gbp");
    expect(provider.paymentConfig.sandbox).toBe(false);
  });

  it("applies provider-specific default base URLs", async () => {
    const cases: Array<[ERPNextPaymentConfig, string]> = [
      [{ provider: "stripe", secretKey: "sk_test" }, "https://api.stripe.com/v1"],
      [
        { provider: "sibs", merchantId: "merchant-1", accessToken: "token-1" },
        "https://api.sibs.pt/gateway/v1",
      ],
      [
        { provider: "gocardless", accessToken: "token-1" },
        "https://api.gocardless.com",
      ],
      [
        {
          provider: "bizum",
          merchantCode: "merchant-1",
          terminal: "1",
          apiKey: "api-key",
        },
        "https://sis-t.redsys.es:25443/sis/rest",
      ],
    ];
    for (const [config, baseUrl] of cases) {
      const provider = await createERPNextPaymentIntegration(config);
      expect(provider.paymentConfig.baseUrl).toBe(baseUrl);
    }
  });

  it("switches the Bizum base URL to live when sandbox is disabled", async () => {
    const provider = await createERPNextPaymentIntegration({
      provider: "bizum",
      merchantCode: "merchant-1",
      terminal: "1",
      apiKey: "api-key",
      sandbox: false,
    });
    expect(provider.paymentConfig.baseUrl).toBe(
      "https://sis.redsys.es:25443/sis/rest"
    );
  });
});

describe("ERPNext payment config validation", () => {
  it("requires a Stripe secretKey", async () => {
    await expect(
      new StripePaymentProvider().initialize({} as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
  });

  it("requires SIBS merchantId and credentials", async () => {
    await expect(
      new SIBSPaymentProvider().initialize({} as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
    await expect(
      new SIBSPaymentProvider().initialize({ merchantId: "merchant-1" } as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
    await expect(
      new SIBSPaymentProvider().initialize({
        merchantId: "merchant-1",
        clientId: "client-1",
      } as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
  });

  it("accepts SIBS client credentials without a pre-issued token", async () => {
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      clientId: "client-1",
      clientSecret: "secret-1",
    } as never);
    expect(provider.paymentConfig.clientId).toBe("client-1");
  });

  it("requires a GoCardless accessToken", async () => {
    await expect(
      new GoCardlessPaymentProvider().initialize({} as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
  });

  it("requires Bizum merchantCode, terminal and signing material", async () => {
    await expect(
      new BizumPaymentProvider().initialize({} as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
    await expect(
      new BizumPaymentProvider().initialize({
        merchantCode: "merchant-1",
      } as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
    await expect(
      new BizumPaymentProvider().initialize({
        merchantCode: "merchant-1",
        terminal: "1",
      } as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
    const provider = new BizumPaymentProvider();
    await provider.initialize({
      merchantCode: "merchant-1",
      terminal: "1",
      signatureProvider: () => ({ Ds_Signature: "signature" }),
    } as never);
    expect(provider.paymentConfig.merchantCode).toBe("merchant-1");
  });
});

describe("ERPNext payment gateway registration", () => {
  it("creates a payment gateway when none exists", async () => {
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      publishableKey: "pk_test",
      apiVersion: "2024-01-01",
      productId: "prod_1",
    } as never);
    const { target, calls } = targetOf({ list: [] });
    const result = await provider.registerGateway(target);

    expect(result).toMatchObject({
      provider: "stripe",
      gateway: "NEW-1",
      created: true,
    });
    expect(result.settings).toMatchObject({
      provider: "stripe",
      recurring: true,
      publishableKey: "pk_test",
      apiVersion: "2024-01-01",
      productId: "prod_1",
      currency: "EUR",
      sandbox: true,
    });
    expect((result.settings as Record<string, unknown>).secretKey).toBeUndefined();

    expect(calls.list[0]).toEqual({
      doctype: "Payment Gateway",
      options: {
        filters: [["gateway", "=", "Stripe"]],
        limitPageLength: 1,
      },
    });
    expect(calls.created[0].doctype).toBe("Payment Gateway");
    expect(calls.created[0].data.gateway).toBe("Stripe");
    expect(JSON.parse(calls.created[0].data.gateway_settings)).toEqual(
      result.settings
    );
  });

  it("updates an existing payment gateway", async () => {
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1" } as never);
    const { target, calls } = targetOf({ list: [{ name: "GC-GATEWAY" }] });
    const result = await provider.registerGateway(target);

    expect(result.created).toBe(false);
    expect(result.gateway).toBe("GC-GATEWAY");
    expect(calls.created).toHaveLength(0);
    expect(calls.updated[0].doctype).toBe("Payment Gateway");
    expect(calls.updated[0].name).toBe("GC-GATEWAY");
    expect(JSON.parse(calls.updated[0].data.gateway_settings)).toMatchObject({
      provider: "gocardless",
      recurring: true,
      environment: "sandbox",
    });
  });

  it("includes secrets only when explicitly requested", async () => {
    const provider = new StripePaymentProvider();
    await provider.initialize({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
    } as never);
    const { target, calls } = targetOf({ list: [] });
    const result = await provider.registerGateway(target, {
      includeSecrets: true,
    });
    expect(result.settings).toMatchObject({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
    });
    expect(JSON.parse(calls.created[0].data.gateway_settings)).toMatchObject({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
    });
  });

  it("honours a gateway name override and environment prefix", async () => {
    process.env.ERPNEXT__PAYMENTS__GATEWAY_NAME_PREFIX = "ERP-";
    const provider = new StripePaymentProvider();
    await provider.initialize({ secretKey: "sk_test" } as never);
    const { target, calls } = targetOf({ list: [] });
    await provider.registerGateway(target);
    expect(calls.list[0].options).toMatchObject({
      filters: [["gateway", "=", "ERP-Stripe"]],
    });

    const { target: custom, calls: customCalls } = targetOf({ list: [] });
    await provider.registerGateway(custom, { gatewayName: "Custom" });
    expect(customCalls.list[0].options).toMatchObject({
      filters: [["gateway", "=", "Custom"]],
    });
  });

  it("accepts a target that exposes the doctype client", async () => {
    const provider = new StripePaymentProvider();
    await provider.initialize({ secretKey: "sk_test" } as never);
    const { target, calls } = targetOf({ list: [] });
    const result = await provider.registerGateway({ client: target });
    expect(result.created).toBe(true);
    expect(calls.created).toHaveLength(1);
  });

  it("rejects an uninitialised provider and an invalid target", async () => {
    const { target } = targetOf();
    await expect(
      new StripePaymentProvider().registerGateway(target)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);

    const provider = new StripePaymentProvider();
    await provider.initialize({ secretKey: "sk_test" } as never);
    await expect(
      provider.registerGateway({ listDocs: async () => [] } as never)
    ).rejects.toBeInstanceOf(ERPNextPaymentConfigurationError);
  });
});

describe("ERPNext payment requests", () => {
  it("posts a Payment Request with the provider approval URL", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: {
        paymentId: "pay_1",
        status: "PENDING",
        paymentUrl: "https://pay.example/approve",
      },
    }));
    const provider = new SIBSPaymentProvider();
    await provider.initialize({
      merchantId: "merchant-1",
      accessToken: "token-1",
      transport,
    } as never);
    const { target, calls: targetCalls } = targetOf();
    const result = await provider.createPaymentRequest(target, {
      amount: 25.5,
      reference: "INV-1",
      party: "CUST-1",
      partyType: "Customer",
      referenceDoctype: "Sales Invoice",
      referenceName: "INV-1",
      transactionDate: new Date("2026-03-04T00:00:00.000Z"),
      message: "Pay now",
    });

    expect(calls[0].url).toBe("https://api.sibs.pt/gateway/v1/payments");
    expect(targetCalls.created[0].doctype).toBe("Payment Request");
    expect(targetCalls.created[0].data).toMatchObject({
      payment_request_type: "Inward",
      reference_doctype: "Sales Invoice",
      reference_name: "INV-1",
      party_type: "Customer",
      party: "CUST-1",
      grand_total: 25.5,
      currency: "EUR",
      status: "Requested",
      payment_gateway: "SIBS",
      transaction_date: "2026-03-04",
      message: "Pay now",
      payment_url: "https://pay.example/approve",
      is_a_subscription: false,
    });
    expect(result.paymentRequest.name).toBe("NEW-1");
    expect(result.payment).toMatchObject({
      provider: "sibs",
      id: "pay_1",
      status: "PENDING",
      approvalUrl: "https://pay.example/approve",
    });
  });
});

describe("ERPNext recurring plan registration", () => {
  const configs: Array<
    [ERPNextPaymentConfig, ERPNextPaymentProviderKey, string]
  > = [
    [
      { provider: "stripe", secretKey: "sk_test", item: "ITEM-1" },
      "stripe",
      "Stripe",
    ],
    [
      {
        provider: "sibs",
        merchantId: "merchant-1",
        accessToken: "token-1",
        item: "ITEM-1",
      },
      "sibs",
      "SIBS",
    ],
    [
      { provider: "gocardless", accessToken: "token-1", item: "ITEM-1" },
      "gocardless",
      "GoCardless",
    ],
    [
      {
        provider: "bizum",
        merchantCode: "merchant-1",
        terminal: "1",
        apiKey: "api-key",
        item: "ITEM-1",
      },
      "bizum",
      "Bizum",
    ],
  ];

  for (const [config, key, gatewayName] of configs) {
    it(`creates an ERPNext Subscription Plan for ${key}`, async () => {
      const provider = await createERPNextPaymentIntegration(config);
      const { target, calls } = targetOf({ list: [] });
      const result = await provider.registerRecurringPlan(target, {
        planName: "Monthly plan",
        amount: 19.99,
        interval: "Month",
        intervalCount: 1,
        providerPlanId: `price_${key}`,
      });

      expect(result).toMatchObject({
        provider: key,
        providerPlanId: `price_${key}`,
        created: true,
      });
      expect(calls.list[0].doctype).toBe("Subscription Plan");
      expect(calls.created[0].doctype).toBe("Subscription Plan");
      expect(calls.created[0].data).toMatchObject({
        plan_name: `Monthly plan (${gatewayName})`,
        item: "ITEM-1",
        cost: 19.99,
        currency: "EUR",
        price_determination: "Fixed Rate",
        billing_interval: "Month",
        billing_interval_count: 1,
        product_price_id: `price_${key}`,
      });
    });
  }

  it("updates an existing plan instead of creating a second one", async () => {
    const provider = await createERPNextPaymentIntegration({
      provider: "stripe",
      secretKey: "sk_test",
      item: "ITEM-1",
    });
    const { target, calls } = targetOf({
      list: [{ name: "PLAN-EXISTING" }],
    });
    const result = await provider.registerRecurringPlan(target, {
      planName: "Monthly plan",
      amount: 5,
      providerPlanId: "price_1",
    });
    expect(result.created).toBe(false);
    expect(result.plan.name).toBe("PLAN-EXISTING");
    expect(calls.updated[0]).toMatchObject({
      doctype: "Subscription Plan",
      name: "PLAN-EXISTING",
    });
  });

  it("requires an ERPNext item for recurring plans", async () => {
    const provider = await createERPNextPaymentIntegration({
      provider: "stripe",
      secretKey: "sk_test",
    });
    const { target } = targetOf();
    await expect(
      provider.registerRecurringPlan(target, {
        planName: "No item",
        amount: 5,
        providerPlanId: "price_1",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("ERPNext recurring subscriptions", () => {
  it("creates an ERPNext Subscription from an existing plan", async () => {
    const { transport, calls } = transportOf((request) => {
      expect(new URL(request.url).pathname).toBe("/subscriptions");
      return {
        status: 200,
        data: { subscriptions: { id: "SB-1", status: "active" } },
      };
    });
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1", transport } as never);
    const { target, calls: targetCalls } = targetOf({
      get: {
        name: "PLAN-A",
        cost: 30,
        product_price_id: "price_plan_a",
      },
    });
    const startDate = new Date("2026-04-05T00:00:00.000Z");
    const result = await provider.createRecurringSubscription(target, {
      subscriptionPlan: "PLAN-A",
      party: "CUST-1",
      mandateId: "MD-1",
      startDate,
      cancelAtPeriodEnd: true,
      qty: 2,
    });

    expect(targetCalls.fetched[0]).toEqual({
      doctype: "Subscription Plan",
      name: "PLAN-A",
    });
    expect(targetCalls.created[0].doctype).toBe("Subscription");
    expect(targetCalls.created[0].data).toMatchObject({
      party_type: "Customer",
      party: "CUST-1",
      plans: [{ plan: "PLAN-A", qty: 2 }],
      start_date: "2026-04-05",
      generate_invoice_at: "Beginning of the current subscription period",
      payment_gateway: "GoCardless",
      status: "Active",
      cancel_at_period_end: 1,
    });
    expect(result).toMatchObject({
      provider: "gocardless",
      providerSubscriptionId: "SB-1",
    });
    expect(result.plan.providerPlanId).toBe("price_plan_a");
    expect(calls[0].data).toMatchObject({
      subscriptions: {
        amount: 3000,
        currency: "EUR",
        interval_unit: "monthly",
        links: { mandate: "MD-1" },
      },
    });
  });

  it("registers the plan first when only planName and amount are given", async () => {
    const { transport } = transportOf(() => ({
      status: 200,
      data: { subscriptions: { id: "SB-2" } },
    }));
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({
      accessToken: "token-1",
      item: "ITEM-1",
      transport,
    } as never);
    const { target, calls } = targetOf({ list: [] });
    const result = await provider.createRecurringSubscription(target, {
      planName: "Annual plan",
      amount: 120,
      interval: "Year",
      party: "CUST-1",
      mandateId: "MD-1",
      generateInvoiceAt: "End of the current subscription period",
    });

    expect(result.plan.providerPlanId).toBeDefined();
    expect(calls.created[0].doctype).toBe("Subscription Plan");
    expect(calls.created[1].doctype).toBe("Subscription");
    expect(calls.created[1].data.generate_invoice_at).toBe(
      "End of the current subscription period"
    );
    expect(calls.created[1].data.cancel_at_period_end).toBeUndefined();
  });

  it("rejects subscriptions without a plan or an amount", async () => {
    const provider = await createERPNextPaymentIntegration({
      provider: "gocardless",
      accessToken: "token-1",
    });
    const { target } = targetOf();
    await expect(
      provider.createRecurringSubscription(target, {
        planName: "Missing amount",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      provider.createRecurringSubscription(target, {} as never)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a stored plan without a provider price id", async () => {
    const provider = await createERPNextPaymentIntegration({
      provider: "gocardless",
      accessToken: "token-1",
    });
    const { target } = targetOf({ get: { name: "PLAN-A", cost: 10 } });
    await expect(
      provider.createRecurringSubscription(target, {
        subscriptionPlan: "PLAN-A",
        mandateId: "MD-1",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a provider that returns no subscription identifier", async () => {
    const { transport } = transportOf(() => ({
      status: 200,
      data: { subscriptions: {} },
    }));
    const provider = new GoCardlessPaymentProvider();
    await provider.initialize({ accessToken: "token-1", transport } as never);
    const { target } = targetOf({
      get: { name: "PLAN-A", cost: 10, product_price_id: "price_a" },
    });
    await expect(
      provider.createRecurringSubscription(target, {
        subscriptionPlan: "PLAN-A",
        mandateId: "MD-1",
      })
    ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
  });
});

describe("ERPNext payment HTTP failure normalization", () => {
  const statuses: Array<[number, unknown]> = [
    [401, ERPNextPaymentAuthenticationError],
    [403, ERPNextPaymentForbiddenError],
    [404, ERPNextPaymentNotFoundError],
    [409, ERPNextPaymentConflictError],
    [400, ERPNextPaymentProviderError],
    [500, ConnectionError],
  ];
  const providers: ERPNextPaymentProviderKey[] = [
    "stripe",
    "sibs",
    "gocardless",
    "bizum",
  ];

  for (const providerKey of providers) {
    it(`maps provider failures for ${providerKey}`, async () => {
      for (const [status, expected] of statuses) {
        const { transport } = transportOf(() => ({
          status,
          data: { message: `failure ${status}` },
        }));
        const provider = await initializedProvider(providerKey, transport);
        await expect(
          provider.createPaymentIntent(intentInput(providerKey) as never)
        ).rejects.toBeInstanceOf(expected as never);
      }
    });

    it(`never leaks a raw transport error for ${providerKey}`, async () => {
      const { transport } = transportOf(() => {
        throw new Error("socket closed");
      });
      const provider = await initializedProvider(providerKey, transport);
      await expect(
        provider.createPaymentIntent(intentInput(providerKey) as never)
      ).rejects.toBeInstanceOf(ERPNextPaymentProviderError);
    });
  }
});
