import type { MaybeContextualArg } from "@decaf-ts/core";
import { ERPNextPaymentsEnvironment } from "./environment";
import {
  ERPNextPaymentConfigurationError,
  ERPNextPaymentProviderError,
} from "./errors";
import { ERPNextPaymentProvider } from "./ERPNextPaymentProvider";
import type {
  ERPNextPaymentIntentInput,
  ERPNextPaymentIntentResult,
  ERPNextPaymentPlanInput,
  ERPNextPaymentSubscriptionInput,
  ERPNextPaymentWebhookEvent,
  StripePaymentProviderConfig,
  StripeSdkClient,
} from "./types";
import {
  fromMinorUnits,
  paymentIntervalUnit,
  toMinorUnits,
} from "./utils";

async function loadStripeSdk(
  config: StripePaymentProviderConfig
): Promise<StripeSdkClient> {
  try {
    const specifier = "stripe";
    const loaded = (await import(/* webpackIgnore: true */ specifier)) as {
      default?: unknown;
    } & Record<string, unknown>;
    const ctor = (loaded.default ?? loaded) as new (
      key: string,
      options?: Record<string, unknown>
    ) => StripeSdkClient;
    return new ctor(config.secretKey, {
      apiVersion: config.apiVersion,
    });
  } catch (e: unknown) {
    throw new ERPNextPaymentConfigurationError(
      `The optional 'stripe' package is not installed; install it or supply StripePaymentProviderConfig.sdk (${e instanceof Error ? e.message : String(e)})`
    );
  }
}

/**
 * @description Stripe payment provider for ERPNext
 * @summary Implements payment intents, setup intents, plans and subscriptions over
 * the Stripe REST API, optionally delegating to the official Stripe SDK when it is
 * installed or supplied through the configuration.
 * @class StripePaymentProvider
 * @category ERPNext
 * @example
 * ```typescript
 * const provider = new StripePaymentProvider();
 * await provider.initialize({ provider: "stripe", secretKey: process.env.STRIPE_SECRET! });
 * const intent = await provider.createPaymentIntent({ amount: 19.99 });
 * ```
 */
export class StripePaymentProvider extends ERPNextPaymentProvider<StripePaymentProviderConfig> {
  private _sdk?: StripeSdkClient;

  constructor() {
    super("stripe");
  }

  /**
   * @description Stripe API base URL
   * @return {string} The Stripe API base URL
   */
  protected defaultBaseUrl(): string {
    return "https://api.stripe.com/v1";
  }

  /**
   * @description Default ERPNext gateway name for Stripe
   * @return {string} The gateway name
   */
  protected defaultGatewayName(): string {
    return "Stripe";
  }

  /**
   * @description Reads Stripe settings from the accumulated environment
   * @return {Partial<StripePaymentProviderConfig>} The environment-derived configuration
   */
  protected environmentConfig(): Partial<StripePaymentProviderConfig> {
    const base = ERPNextPaymentsEnvironment.erpnext.payments;
    const env = base.stripe;
    return {
      secretKey: env.secretKey || undefined,
      publishableKey: env.publishableKey || undefined,
      apiVersion: env.apiVersion || undefined,
      productId: env.productId || undefined,
      webhookSecret: env.webhookSecret || undefined,
      baseUrl: env.baseUrl || undefined,
      currency: base.currency,
      sandbox: base.sandbox,
      timeout: base.timeout,
    } as Partial<StripePaymentProviderConfig>;
  }

  /**
   * @description Validates the Stripe configuration
   * @summary Requires a secret key or an injected SDK client.
   * @param {StripePaymentProviderConfig} config - The resolved configuration
   * @return {void}
   */
  protected validatePaymentConfig(config: StripePaymentProviderConfig): void {
    if (!config.secretKey)
      throw new ERPNextPaymentConfigurationError(
        "Stripe requires a secretKey (or StripePaymentProviderConfig.sdk)"
      );
  }

  /**
   * @description Builds the Stripe authorization headers
   * @summary Sets the bearer secret key and, when configured, the Stripe API version.
   * @param {StripePaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, string>} The authorization headers
   */
  protected authHeaders(
    config: StripePaymentProviderConfig
  ): Record<string, string> {
    return {
      authorization: `Bearer ${config.secretKey}`,
      ...(config.apiVersion ? { "stripe-version": config.apiVersion } : {}),
    };
  }

  /**
   * @description Public gateway settings persisted in ERPNext
   * @param {StripePaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Non-secret gateway settings
   */
  protected publicGatewaySettings(
    config: StripePaymentProviderConfig
  ): Record<string, unknown> {
    return {
      publishableKey: config.publishableKey,
      apiVersion: config.apiVersion,
      currency: config.currency,
      sandbox: config.sandbox,
      productId: config.productId,
    };
  }

  /**
   * @description Secret gateway settings persisted in ERPNext
   * @param {StripePaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Secret gateway settings
   */
  protected override secretGatewaySettings(
    config: StripePaymentProviderConfig
  ): Record<string, unknown> {
    return {
      secretKey: config.secretKey,
      webhookSecret: config.webhookSecret,
    };
  }

  /**
   * @description Resolves the Stripe SDK client, when one is available
   * @summary Returns the injected or cached SDK, loads it lazily, and falls back to the
   * REST transport when `preferSdk` is not set.
   * @return {Promise<StripeSdkClient|undefined>} The SDK client, or `undefined`
   */
  protected async sdk(): Promise<StripeSdkClient | undefined> {
    const config = this.ensureConfigured();
    if (config.sdk) return config.sdk;
    if (this._sdk) return this._sdk;
    if (config.loadSdk) {
      this._sdk = await config.loadSdk();
      return this._sdk;
    }
    if (!config.preferSdk) return undefined;
    this._sdk = await loadStripeSdk(config);
    return this._sdk;
  }

  /**
   * @description Creates a Stripe payment intent
   * @summary Uses the SDK when available and otherwise posts to `/payment_intents`,
   * enabling automatic payment methods.
   * @param {ERPNextPaymentIntentInput} input - Payment intent input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  async createPaymentIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    const config = this.ensureConfigured();
    const currency = this.currency(input.currency, config);
    const amount = toMinorUnits(input.amount, currency);
    const metadata = this.metadata(input);
    const sdk = await this.sdk();
    if (sdk) {
      const raw = await sdk.paymentIntents.create({
        amount,
        currency: currency.toLowerCase(),
        customer: input.customer ?? config.customerId,
        description: input.description,
        metadata,
        automatic_payment_methods: { enabled: true },
      });
      return this.intentResult(raw);
    }
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/payment_intents",
      {
        encoding: "form",
        data: {
          amount,
          currency: currency.toLowerCase(),
          customer: input.customer ?? config.customerId,
          description: input.description,
          metadata,
          automatic_payment_methods: { enabled: true },
        },
      },
      ...args
    );
    return this.intentResult(raw);
  }

  /**
   * @description Creates a Stripe setup intent
   * @summary Uses the SDK or the REST API to save a payment method for future use.
   * @param {ERPNextPaymentIntentInput} input - Setup intent input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  async createSetupIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    const config = this.ensureConfigured();
    const metadata = this.metadata(input);
    const customer = input.customer ?? config.customerId;
    const sdk = await this.sdk();
    if (sdk?.setupIntents) {
      const raw = await sdk.setupIntents.create({
        customer,
        description: input.description,
        metadata,
      });
      return this.intentResult(raw);
    }
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/setup_intents",
      {
        encoding: "form",
        data: {
          customer,
          description: input.description,
          metadata,
        },
      },
      ...args
    );
    return this.intentResult(raw);
  }

  /**
   * @description Creates or resolves a Stripe plan
   * @summary Creates a plan with the normalized amount, currency and interval and
   * returns its id.
   * @param {ERPNextPaymentPlanInput} input - Plan input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<string>} The provider plan id
   */
  async ensureProviderPlan(
    input: ERPNextPaymentPlanInput,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const config = this.ensureConfigured();
    const currency = this.currency(input.currency, config);
    const amount = toMinorUnits(input.amount, currency);
    const interval = paymentIntervalUnit(input.interval);
    const intervalCount = input.intervalCount ?? 1;
    const productId = input.productId ?? config.productId;
    const sdk = await this.sdk();
    let raw: Record<string, any>;
    if (sdk?.plans) {
      raw = await sdk.plans.create({
        amount,
        currency: currency.toLowerCase(),
        interval,
        interval_count: intervalCount,
        product: productId,
        ...(productId ? {} : { product_data: { name: input.planName } }),
        nickname: input.planName,
      });
    } else {
      raw = await this.request<Record<string, any>>(
        "POST",
        "/plans",
        {
          encoding: "form",
          data: {
            amount,
            currency: currency.toLowerCase(),
            interval,
            interval_count: intervalCount,
            product: productId,
            product_data: productId ? undefined : { name: input.planName },
            nickname: input.planName,
          },
        },
        ...args
      );
    }
    if (!raw?.id)
      throw new ERPNextPaymentProviderError(
        "Stripe did not return a plan identifier"
      );
    return String(raw.id);
  }

  /**
   * @description Creates a Stripe recurring subscription
   * @summary Requires a Stripe customer and attaches the provider plan, requesting an
   * incomplete payment behavior for SCA.
   * @param {ERPNextPaymentSubscriptionInput} input - Subscription input with plan and amount
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<object>} The provider subscription id and raw response
   */
  async createProviderSubscription(
    input: ERPNextPaymentSubscriptionInput & {
      providerPlanId: string;
      amount: number | string;
      currency: string;
    },
    ...args: MaybeContextualArg<any>
  ): Promise<{ id: string; raw: Record<string, any> }> {
    const config = this.ensureConfigured();
    const customer = input.customer ?? config.customerId;
    if (!customer)
      throw new ERPNextPaymentConfigurationError(
        "Stripe recurring subscriptions require a customer identifier"
      );
    const metadata = this.metadata(input);
    const sdk = await this.sdk();
    let raw: Record<string, any>;
    if (sdk?.subscriptions) {
      raw = await sdk.subscriptions.create({
        customer,
        items: [{ plan: input.providerPlanId }],
        metadata,
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      });
    } else {
      raw = await this.request<Record<string, any>>(
        "POST",
        "/subscriptions",
        {
          encoding: "form",
          data: {
            customer,
            items: [{ plan: input.providerPlanId }],
            metadata,
            payment_behavior: "default_incomplete",
            expand: ["latest_invoice.payment_intent"],
          },
        },
        ...args
      );
    }
    if (!raw?.id)
      throw new ERPNextPaymentProviderError(
        "Stripe did not return a subscription identifier"
      );
    return { id: String(raw.id), raw };
  }

  /**
   * @description Normalizes Stripe webhook events
   * @summary Maps payment intent, setup intent and subscription events to normalized
   * statuses and ERPNext actions.
   * @param {unknown} payload - The raw Stripe event
   * @return {ERPNextPaymentWebhookEvent[]} The normalized events
   */
  parseWebhook(payload: unknown): ERPNextPaymentWebhookEvent[] {
    const event = payload as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, any> };
    };
    const type = typeof event?.type === "string" ? event.type : "";
    if (!type) return [];
    const object = event.data?.object ?? {};
    const currency =
      typeof object.currency === "string"
        ? object.currency.toUpperCase()
        : undefined;
    const amount =
      typeof object.amount === "number"
        ? fromMinorUnits(object.amount, currency)
        : typeof object.amount_paid === "number"
          ? fromMinorUnits(object.amount_paid, currency)
          : undefined;
    const subscription =
      typeof object.subscription === "string"
        ? object.subscription
        : object.subscription && typeof object.subscription.id === "string"
          ? object.subscription.id
          : type.startsWith("customer.subscription")
            ? object.id
            : undefined;

    let status: ERPNextPaymentWebhookEvent["status"] = "unknown";
    let actions: ERPNextPaymentWebhookEvent["actions"] = ["ignore"];
    if (
      type === "payment_intent.succeeded" ||
      type === "invoice.paid" ||
      type === "setup_intent.succeeded"
    ) {
      status = "succeeded";
      actions = type === "setup_intent.succeeded" ? ["ignore"] : ["mark-paid"];
    } else if (
      type === "payment_intent.payment_failed" ||
      type === "invoice.payment_failed"
    ) {
      status = "failed";
      actions = ["mark-failed"];
    } else if (
      type === "payment_intent.processing" ||
      type === "invoice.payment_action_required"
    ) {
      status = "pending";
      actions = ["ignore"];
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated"
    ) {
      status = "active";
      actions = ["activate-subscription"];
    } else if (type === "customer.subscription.deleted") {
      status = "cancelled";
      actions = ["cancel-subscription"];
    }

    return [
      {
        provider: this.provider,
        id: event.id,
        type,
        status,
        paymentId:
          ['payment_intent', 'invoice'].some((prefix) =>
            type.startsWith(prefix)
          ) && typeof object.id === "string"
            ? object.id
            : undefined,
        subscriptionId:
          typeof subscription === "string" ? subscription : undefined,
        amount,
        currency,
        actions,
        raw: payload,
      },
    ];
  }

  /**
   * @description Builds the Stripe metadata payload from the intent input
   * @summary Copies custom metadata and always adds the merchant reference when present.
   * @param {ERPNextPaymentIntentInput} input - Payment intent input
   * @return {Record<string, unknown>|undefined} The metadata payload
   */
  private metadata(
    input: ERPNextPaymentIntentInput
  ): Record<string, unknown> | undefined {
    return Object.keys(input.metadata ?? {}).length
      ? { ...input.metadata, reference: input.reference }
      : input.reference
        ? { reference: input.reference }
        : undefined;
  }

  /**
   * @description Maps a Stripe response to the normalized intent result
   * @param {Record<string, any>} raw - The raw provider response
   * @return {ERPNextPaymentIntentResult} The normalized intent result
   */
  private intentResult(
    raw: Record<string, any>
  ): ERPNextPaymentIntentResult {
    if (!raw?.id)
      throw new ERPNextPaymentProviderError(
        "Stripe did not return a payment intent identifier"
      );
    return {
      provider: this.provider,
      id: String(raw.id),
      status: String(raw.status ?? "unknown"),
      clientSecret: raw.client_secret,
      raw,
    };
  }
}
