import {
  ClientBasedService,
  ContextualArgs,
  MaybeContextualArg,
  PersistenceKeys,
} from "@decaf-ts/core";
import { BaseError, ValidationError } from "@decaf-ts/db-decorators";
import { formatERPNextDate } from "../serialization";
import {
  ERPNextPaymentDefaultCurrency,
  ERPNextPaymentDoctypes,
} from "./constants";
import { ERPNextPaymentsEnvironment } from "./environment";
import {
  ERPNextPaymentConfigurationError,
  ERPNextPaymentProviderError,
  ERPNextPaymentUnsupportedError,
  ERPNextPaymentWebhookError,
  parsePaymentProviderError,
} from "./errors";
import type {
  ERPNextPaymentBodyEncoding,
  ERPNextPaymentGatewayOptions,
  ERPNextPaymentGatewayRegistration,
  ERPNextPaymentIntentInput,
  ERPNextPaymentIntentResult,
  ERPNextPaymentPlanInput,
  ERPNextPaymentPlanResult,
  ERPNextPaymentProviderConfig,
  ERPNextPaymentProviderKey,
  ERPNextPaymentRequestInput,
  ERPNextPaymentRequestResult,
  ERPNextPaymentSubscriptionInput,
  ERPNextPaymentSubscriptionResult,
  ERPNextPaymentTarget,
  ERPNextPaymentTransport,
  ERPNextPaymentWebhookEvent,
  ERPNextPaymentWebhookOptions,
} from "./types";
import {
  compactPaymentRecord,
  createERPNextPaymentFetchTransport,
  normalizePaymentInterval,
  toPaymentFormBody,
} from "./utils";

/**
 * @description Minimal ERPNext client surface used by payment providers
 * @summary Structural subset of the ERPNext REST client needed to register
 * gateways and persist payment requests, plans and subscriptions.
 * @interface ERPNextPaymentDoctypeClient
 * @property {function} listDocs Lists doctype documents
 * @property {function} getDoc Reads a single document
 * @property {function} createDoc Creates a document
 * @property {function} updateDoc Updates a document
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentDoctypeClient {
  listDocs(
    doctype: string,
    options?: Record<string, unknown>
  ): Promise<Record<string, any>[]>;
  getDoc(doctype: string, name: string): Promise<Record<string, any>>;
  createDoc(
    doctype: string,
    data: Record<string, any>
  ): Promise<Record<string, any>>;
  updateDoc(
    doctype: string,
    name: string,
    data: Record<string, any>
  ): Promise<Record<string, any>>;
}

/**
 * @description Options accepted by {@link ERPNextPaymentProvider.request}
 * @summary Controls the request body encoding, extra headers and query string.
 * @interface ERPNextPaymentHttpRequestOptions
 * @property {unknown} [data] Request body
 * @property {ERPNextPaymentBodyEncoding} [encoding] Body encoding
 * @property {Record<string, string>} [headers] Extra headers
 * @property {object} [query] Query string parameters
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentHttpRequestOptions {
  data?: unknown;
  encoding?: ERPNextPaymentBodyEncoding;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * @description Resolves a doctype client from an ERPNext adapter or client
 * @summary Accepts either an object that already exposes the doctype methods or a
 * wrapper with a `client`, and throws {@link ERPNextPaymentConfigurationError} when
 * neither works.
 * @param {ERPNextPaymentTarget} target - The adapter, client or wrapper
 * @return {ERPNextPaymentDoctypeClient} The resolved doctype client
 */
export function resolveERPNextPaymentClient(
  target: ERPNextPaymentTarget
): ERPNextPaymentDoctypeClient {
  const candidate =
    typeof target?.listDocs === "function"
      ? target
      : target && typeof target.client === "object"
        ? target.client
        : undefined;
  if (
    !candidate ||
    typeof candidate.listDocs !== "function" ||
    typeof candidate.getDoc !== "function" ||
    typeof candidate.createDoc !== "function" ||
    typeof candidate.updateDoc !== "function"
  )
    throw new ERPNextPaymentConfigurationError(
      "Payment integration requires an ERPNextAdapter or an initialised ERPNextClient"
    );
  return candidate as ERPNextPaymentDoctypeClient;
}

/**
 * @description Base class for ERPNext payment provider integrations
 * @summary Defines the provider lifecycle and the shared ERPNext orchestration:
 * initialization from the environment, gateway registration, payment request
 * creation, recurring plans and subscriptions, and verified webhook handling.
 * Concrete providers implement the provider-specific primitives such as
 * {@link ERPNextPaymentProvider.createPaymentIntent}.
 * @template C - The provider configuration type
 * @class ERPNextPaymentProvider
 * @category ERPNext
 * @example
 * ```typescript
 * const provider = await createERPNextPaymentIntegration({
 *   provider: "stripe",
 *   secretKey: process.env.STRIPE_SECRET!,
 * });
 * await provider.registerGateway(adapter);
 * ```
 */
export abstract class ERPNextPaymentProvider<
  C extends ERPNextPaymentProviderConfig = ERPNextPaymentProviderConfig,
> extends ClientBasedService<ERPNextPaymentTransport, C> {
  protected constructor(public readonly provider: ERPNextPaymentProviderKey) {
    super();
  }

  /**
   * @description Returns the provider API base URL
   * @summary Implemented by each provider to supply its default endpoint.
   * @param {C} [config] - The resolved configuration
   * @return {string} The default base URL
   */
  protected abstract defaultBaseUrl(config?: C): string;

  /**
   * @description Returns the default ERPNext gateway name
   * @summary Implemented by each provider; may be prefixed by the configured gateway
   * name prefix.
   * @return {string} The default gateway name
   */
  protected abstract defaultGatewayName(): string;

  /**
   * @description Reads provider settings from the environment
   * @summary Implemented by each provider to project the accumulated
   * `erpnext.payments` namespace onto its configuration type.
   * @return {Partial<C>} The environment-derived configuration
   */
  protected abstract environmentConfig(): Partial<C>;

  /**
   * @description Validates the provider configuration
   * @summary Implemented by each provider to reject incomplete credentials before use.
   * @param {C} config - The resolved configuration
   * @return {void}
   */
  protected abstract validatePaymentConfig(config: C): void;

  /**
   * @description Builds the provider authorization headers
   * @summary Implemented by each provider; may be asynchronous when a token must be
   * obtained first.
   * @param {C} config - The resolved configuration
   * @return {Promise<Record<string, string>>|Record<string, string>} The auth headers
   */
  protected abstract authHeaders(
    config: C
  ): Promise<Record<string, string>> | Record<string, string>;

  /**
   * @description Builds the public gateway settings
   * @summary Implemented by each provider with the non-secret settings persisted in the
   * ERPNext Payment Gateway document.
   * @param {C} config - The resolved configuration
   * @return {Record<string, unknown>} The public settings
   */
  protected abstract publicGatewaySettings(
    config: C
  ): Record<string, unknown>;

  /**
   * @description Builds the secret gateway settings
   * @summary Providers override this to include secrets that are only persisted when
   * `includeSecrets` is requested. Defaults to an empty record.
   * @param {C} [_config] - The resolved configuration
   * @return {Record<string, unknown>} The secret settings
   */
  protected secretGatewaySettings(_config?: C): Record<string, unknown> {
    void _config;
    return {};
  }

  /**
   * @description Creates a provider payment intent
   * @summary Provider-specific primitive used by {@link createPaymentRequest}.
   * @param {ERPNextPaymentIntentInput} input - Payment intent input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  abstract createPaymentIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult>;

  /**
   * @description Resolves or creates the provider plan id
   * @summary Provider-specific primitive used by {@link registerRecurringPlan}.
   * @param {ERPNextPaymentPlanInput} input - Plan input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<string>} The provider plan id
   */
  abstract ensureProviderPlan(
    input: ERPNextPaymentPlanInput,
    ...args: MaybeContextualArg<any>
  ): Promise<string>;

  /**
   * @description Creates a provider recurring subscription
   * @summary Provider-specific primitive used by {@link createRecurringSubscription}.
   * @param {ERPNextPaymentSubscriptionInput} input - Subscription input with plan and amount
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<object>} The provider subscription id and raw response
   */
  abstract createProviderSubscription(
    input: ERPNextPaymentSubscriptionInput & {
      providerPlanId: string;
      amount: number | string;
      currency: string;
    },
    ...args: MaybeContextualArg<any>
  ): Promise<{
    id: string;
    raw: Record<string, any>;
  }>;

  /**
   * @description Normalizes a provider webhook payload
   * @summary Provider-specific primitive used by {@link handleWebhook}.
   * @param {unknown} payload - The raw webhook payload
   * @return {ERPNextPaymentWebhookEvent[]} The normalized events
   */
  abstract parseWebhook(
    payload: unknown
  ): ERPNextPaymentWebhookEvent[];

  /**
   * @description The resolved provider configuration
   * @summary Returns the configuration installed by {@link initialize}.
   * @return {C} The resolved configuration
   */
  get paymentConfig(): C {
    return this.config;
  }

  /**
   * @description Initializes the provider with environment and explicit config
   * @summary Merges the accumulated environment with the supplied configuration,
   * applies defaults, validates the result and installs the HTTP transport.
   * @param {...ContextualArgs<any>} args - Optional configuration and contextual arguments
   * @return {Promise<object>} The resolved config and transport
   */
  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: C; client: ERPNextPaymentTransport }> {
    const { ctxArgs } = (
      await this.logCtx(args, PersistenceKeys.INITIALIZATION, true)
    ).for(this.initialize);
    const provided = (ctxArgs[0] ?? {}) as Partial<C>;
    const environment = this.environmentConfig();
    const baseEnvironment = ERPNextPaymentsEnvironment.erpnext.payments;
    const config = {
      ...environment,
      ...provided,
      provider: this.provider,
    } as C;
    if (!config.currency)
      config.currency = baseEnvironment.currency || ERPNextPaymentDefaultCurrency;
    if (!config.baseUrl) config.baseUrl = this.defaultBaseUrl(config);
    if (!config.timeout) config.timeout = baseEnvironment.timeout;
    if (typeof config.sandbox === "undefined")
      config.sandbox = baseEnvironment.sandbox;
    this.validatePaymentConfig(config);
    const client = config.transport ?? createERPNextPaymentFetchTransport();
    this._config = config;
    this._client = client;
    return { config, client };
  }

  /**
   * @description Creates or updates the ERPNext payment gateway
   * @summary Persists the gateway settings in the `Payment Gateway` doctype, creating it
   * when absent and updating it otherwise.
   * @param {ERPNextPaymentTarget} target - The ERPNext adapter or client
   * @param {ERPNextPaymentGatewayOptions} [options] - Gateway registration options
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentGatewayRegistration>} The registration result
   */
  async registerGateway(
    target: ERPNextPaymentTarget,
    options: ERPNextPaymentGatewayOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentGatewayRegistration> {
    const { log } = (
      await this.logCtx(args, "registerGateway", true)
    ).for(this.registerGateway);
    const config = this.ensureConfigured();
    const client = resolveERPNextPaymentClient(target);
    const gatewayName = options.gatewayName ?? this.gatewayName(config);
    const settings = {
      provider: this.provider,
      recurring: true,
      ...this.publicGatewaySettings(config),
      ...(options.includeSecrets ? this.secretGatewaySettings(config) : {}),
    };
    const existing = await client.listDocs(ERPNextPaymentDoctypes.gateway, {
      filters: [["gateway", "=", gatewayName]],
      limitPageLength: 1,
    });
    let gateway: Record<string, any>;
    let created = false;
    if (existing.length) {
      gateway = await client.updateDoc(
        ERPNextPaymentDoctypes.gateway,
        existing[0].name,
        {
          gateway: gatewayName,
          gateway_settings: JSON.stringify(settings),
        }
      );
    } else {
      gateway = await client.createDoc(ERPNextPaymentDoctypes.gateway, {
        gateway: gatewayName,
        gateway_settings: JSON.stringify(settings),
      });
      created = true;
    }
    log.info(
      `${this.provider} payment gateway ${gatewayName} ${created ? "registered" : "updated"}`
    );
    return {
      provider: this.provider,
      gateway: String(gateway.name ?? gatewayName),
      created,
      settings,
    };
  }

  /**
   * @description Creates a payment intent and ERPNext request
   * @summary Creates the provider intent and persists a `Payment Request` document with
   * the payment URL and request metadata.
   * @param {ERPNextPaymentTarget} target - The ERPNext adapter or client
   * @param {ERPNextPaymentRequestInput} input - Payment request input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentRequestResult>} The request and provider intent
   */
  async createPaymentRequest(
    target: ERPNextPaymentTarget,
    input: ERPNextPaymentRequestInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentRequestResult> {
    const { log } = (
      await this.logCtx(args, "createPaymentRequest", true)
    ).for(this.createPaymentRequest);
    const config = this.ensureConfigured();
    const client = resolveERPNextPaymentClient(target);
    const currency = this.currency(input.currency, config);
    const payment = await this.createPaymentIntent(
      { ...input, currency },
      ...args
    );
    const record = compactPaymentRecord({
      payment_request_type: input.paymentRequestType ?? "Inward",
      reference_doctype: input.referenceDoctype ?? "Sales Invoice",
      reference_name: input.referenceName,
      party_type: input.partyType ?? "Customer",
      party: input.party,
      grand_total: input.amount,
      currency,
      status: "Requested",
      payment_gateway: this.gatewayName(config),
      transaction_date: formatERPNextDate(
        this.toDate(input.transactionDate ?? new Date())
      ),
      message: input.message,
      payment_url: payment.approvalUrl,
      is_a_subscription: false,
    });
    const paymentRequest = await client.createDoc(
      ERPNextPaymentDoctypes.paymentRequest,
      record
    );
    log.info(
      `${this.provider} payment request ${paymentRequest.name ?? payment.id} created`
    );
    return { paymentRequest, payment };
  }

  /**
   * @description Creates or updates an ERPNext subscription plan
   * @summary Resolves the provider plan and persists it in the `Subscription Plan`
   * doctype with billing interval and price determination.
   * @param {ERPNextPaymentTarget} target - The ERPNext adapter or client
   * @param {ERPNextPaymentPlanInput} input - Plan input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentPlanResult>} The registered plan
   */
  async registerRecurringPlan(
    target: ERPNextPaymentTarget,
    input: ERPNextPaymentPlanInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentPlanResult> {
    const { log } = (
      await this.logCtx(args, "registerRecurringPlan", true)
    ).for(this.registerRecurringPlan);
    const config = this.ensureConfigured();
    const client = resolveERPNextPaymentClient(target);
    const currency = this.currency(input.currency, config);
    const interval = normalizePaymentInterval(input.interval);
    const intervalCount = input.intervalCount ?? 1;
    const item = input.item ?? config.item;
    if (!item)
      throw new ValidationError(
        `${this.provider} recurring plans require an ERPNext item identifier`
      );
    const providerPlanId =
      input.providerPlanId ??
      (await this.ensureProviderPlan(
        { ...input, currency, interval, intervalCount },
        ...args
      ));
    if (!providerPlanId)
      throw new ERPNextPaymentProviderError(
        `${this.provider} did not return a provider plan identifier`
      );
    const planName =
      input.erpnextPlanName ??
      `${input.planName} (${this.gatewayName(config)})`;
    const record = compactPaymentRecord({
      plan_name: planName,
      item,
      cost: input.amount,
      currency,
      price_determination: input.priceDetermination ?? "Fixed Rate",
      billing_interval: interval,
      billing_interval_count: intervalCount,
      product_price_id: providerPlanId,
      payment_gateway: this.gatewayName(config),
    });
    const existing = await client.listDocs(
      ERPNextPaymentDoctypes.subscriptionPlan,
      {
        filters: [["plan_name", "=", planName]],
        limitPageLength: 1,
      }
    );
    let plan: Record<string, any>;
    let created = false;
    if (existing.length) {
      plan = await client.updateDoc(
        ERPNextPaymentDoctypes.subscriptionPlan,
        existing[0].name,
        record
      );
    } else {
      plan = await client.createDoc(
        ERPNextPaymentDoctypes.subscriptionPlan,
        record
      );
      created = true;
    }
    log.info(
      `${this.provider} recurring plan ${plan.name ?? planName} ${created ? "registered" : "updated"}`
    );
    return {
      provider: this.provider,
      providerPlanId,
      plan: plan.name ? plan : { ...plan, name: planName },
      created,
    };
  }

  /**
   * @description Creates a recurring provider subscription
   * @summary Resolves the subscription plan, creates the provider subscription and
   * persists the ERPNext `Subscription` document.
   * @param {ERPNextPaymentTarget} target - The ERPNext adapter or client
   * @param {ERPNextPaymentSubscriptionInput} input - Subscription input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentSubscriptionResult>} The created subscription
   */
  async createRecurringSubscription(
    target: ERPNextPaymentTarget,
    input: ERPNextPaymentSubscriptionInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentSubscriptionResult> {
    const { log } = (
      await this.logCtx(args, "createRecurringSubscription", true)
    ).for(this.createRecurringSubscription);
    const config = this.ensureConfigured();
    const client = resolveERPNextPaymentClient(target);
    const currency = this.currency(input.currency, config);
    const plan = await this.resolveSubscriptionPlan(
      client,
      target,
      input,
      currency,
      args
    );
    const amount = input.amount ?? plan.plan.cost;
    if (typeof amount === "undefined" || amount === null)
      throw new ValidationError(
        `${this.provider} recurring subscription requires an amount or a priced subscription plan`
      );
    const providerSubscription = await this.createProviderSubscription(
      {
        ...input,
        providerPlanId: plan.providerPlanId,
        amount,
        currency,
      },
      ...args
    );
    if (!providerSubscription.id)
      throw new ERPNextPaymentProviderError(
        `${this.provider} did not return a provider subscription identifier`
      );
    const subscription = await client.createDoc(
      ERPNextPaymentDoctypes.subscription,
      compactPaymentRecord({
        party_type: input.partyType ?? "Customer",
        party: input.party,
        company: input.company,
        plans: [
          {
            plan: String(
              plan.plan.name ??
                plan.plan.plan_name ??
                input.subscriptionPlan
            ),
            qty: input.qty ?? 1,
          },
        ],
        start_date: formatERPNextDate(
          this.toDate(input.startDate ?? new Date())
        ),
        generate_invoice_at:
          input.generateInvoiceAt ??
          "Beginning of the current subscription period",
        payment_gateway: this.gatewayName(config),
        status: "Active",
        cancel_at_period_end: input.cancelAtPeriodEnd ? 1 : undefined,
      })
    );
    log.info(
      `${this.provider} recurring subscription ${subscription.name ?? providerSubscription.id} created`
    );
    return {
      provider: this.provider,
      providerSubscriptionId: providerSubscription.id,
      subscription,
      plan,
      raw: providerSubscription.raw,
    };
  }

  /**
   * @description Verifies and normalizes an incoming provider webhook
   * @summary Fails closed when `config.webhookSecret` is configured: an unsigned
   * payload (no `options.signature`) is rejected with
   * {@link ERPNextPaymentWebhookError} before parsing. When a signature is supplied,
   * the configured `webhookVerifier` must accept it; a missing verifier raises
   * {@link ERPNextPaymentUnsupportedError} and a throwing verifier is wrapped in
   * {@link ERPNextPaymentWebhookError}. Unsigned payloads remain processable only
   * when no `webhookSecret` is set. Recognized payloads are parsed and any payload
   * without a recognized event is rejected.
   * @param {unknown} payload - The raw webhook payload
   * @param {ERPNextPaymentWebhookOptions} [options] - Webhook options such as the signature
   * @return {Promise<ERPNextPaymentWebhookEvent[]>} The normalized events
   */
  async handleWebhook(
    payload: unknown,
    options: ERPNextPaymentWebhookOptions = {}
  ): Promise<ERPNextPaymentWebhookEvent[]> {
    await Promise.resolve();
    const config = this.ensureConfigured();
    if (config.webhookSecret && !options.signature)
      throw new ERPNextPaymentWebhookError(
        `${this.provider} webhook rejected: config.webhookSecret is configured but no signature was supplied`
      );
    if (options.signature) {
      if (!config.webhookVerifier)
        throw new ERPNextPaymentUnsupportedError(
          `${this.provider} webhook verification requires config.webhookVerifier`
        );
      let valid: boolean;
      try {
        valid = await config.webhookVerifier(payload, options.signature);
      } catch (e: unknown) {
        throw new ERPNextPaymentWebhookError(
          e instanceof Error
            ? e
            : `${this.provider} webhook signature verification failed`
        );
      }
      if (!valid)
        throw new ERPNextPaymentWebhookError(
          `${this.provider} webhook signature verification failed`
        );
    }
    const events = this.parseWebhook(payload);
    if (!events.length)
      throw new ERPNextPaymentWebhookError(
        `${this.provider} webhook payload did not contain any recognised event`
      );
    return events;
  }

  /**
   * @description Performs an authenticated provider request
   * @summary Resolves the URL, merges headers, applies body encoding and maps HTTP and
   * transport failures to the decaf payment error hierarchy.
   * @param {string} method - The HTTP method
   * @param {string} path - The provider path or absolute URL
   * @param {ERPNextPaymentHttpRequestOptions} [options] - Request options
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<T>} The decoded response body
   */
  protected async request<T = Record<string, any>>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: ERPNextPaymentHttpRequestOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log } = (await this.logCtx(args, "request", true)).for(
      this.request
    );
    const config = this.ensureConfigured();
    const url = this.absoluteUrl(path, options.query);
    const headers: Record<string, string> = {
      ...(config.headers ?? {}),
      ...(await this.authHeaders(config)),
      ...(options.headers ?? {}),
    };
    let data = options.data;
    if (options.encoding === "form" && data && typeof data === "object") {
      if (!(data instanceof URLSearchParams))
        data = toPaymentFormBody(data as Record<string, unknown>);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type"))
        headers["content-type"] = "application/x-www-form-urlencoded";
    } else if (
      data &&
      typeof data === "object" &&
      !(data instanceof FormData) &&
      !(data instanceof URLSearchParams)
    ) {
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type"))
        headers["content-type"] = "application/json";
    }
    let response;
    try {
      response = await this.client({
        method,
        url,
        headers,
        data,
        timeout: config.timeout,
      });
    } catch (e: unknown) {
      log.error(`${this.provider} payment request failed`, e as Error);
      if (e instanceof BaseError) throw e;
      throw new ERPNextPaymentProviderError(e as Error);
    }
    if (response.status < 200 || response.status >= 300) {
      log.error(
        `${this.provider} payment request failed with HTTP ${response.status}`
      );
      throw parsePaymentProviderError(
        this.provider,
        response.status,
        response.data
      );
    }
    return response.data as T;
  }

  /**
   * @description Resolves the gateway name, applying the configured prefix
   * @param {C} [config] - The resolved configuration
   * @return {string} The gateway name
   */
  protected gatewayName(config: C = this.config): string {
    const prefix = ERPNextPaymentsEnvironment.erpnext.payments.gatewayNamePrefix;
    const name = config.gatewayName ?? this.defaultGatewayName();
    return prefix && !name.startsWith(prefix) ? `${prefix}${name}` : name;
  }

  /**
   * @description Normalizes the currency code
   * @summary Falls back to the configured or default currency and upper-cases the result.
   * @param {string} [value] - Explicit currency
   * @param {C} config - The resolved configuration
   * @return {string} The normalized currency code
   */
  protected currency(value: string | undefined, config: C): string {
    return String(value ?? config.currency ?? ERPNextPaymentDefaultCurrency)
      .trim()
      .toUpperCase();
  }

  /**
   * @description Returns the initialized configuration
   * @summary Throws {@link ERPNextPaymentConfigurationError} when the provider has not
   * been initialized.
   * @return {C} The resolved configuration
   */
  protected ensureConfigured(): C {
    if (!this._config)
      throw new ERPNextPaymentConfigurationError(
        `${this.provider} payment provider is not initialized; call initialize(config) first`
      );
    return this._config;
  }

  /**
   * @description Builds an absolute URL with optional query parameters
   * @summary Joins the base URL and path, preserving absolute paths, and appends the
   * defined query values.
   * @param {string} path - The provider path or absolute URL
   * @param {object} [query] - Query string parameters
   * @return {string} The absolute URL
   */
  protected absoluteUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const config = this.config;
    const base = (config.baseUrl ?? this.defaultBaseUrl(config)).replace(/\/+$/, "");
    const url = /^https?:\/\//.test(path)
      ? path
      : `${base}${path.startsWith("/") ? path : `/${path}`}`;
    if (!query) return url;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "undefined") continue;
      search.append(key, String(value));
    }
    const serialized = search.toString();
    return serialized
      ? `${url}${url.includes("?") ? "&" : "?"}${serialized}`
      : url;
  }

  /**
   * @description Coerces a date value to a Date instance
   * @param {Date|string} value - The date value
   * @return {Date} The Date instance
   */
  protected toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  /**
   * @description Resolves the plan for a recurring subscription
   * @summary Loads an existing ERPNext subscription plan by name or registers a new
   * provider plan when only a plan name and amount are supplied.
   * @param {ERPNextPaymentDoctypeClient} client - The doctype client
   * @param {ERPNextPaymentTarget} target - The ERPNext adapter or client
   * @param {ERPNextPaymentSubscriptionInput} input - Subscription input
   * @param {string} currency - The normalized currency
   * @param {MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentPlanResult>} The resolved plan
   */
  private async resolveSubscriptionPlan(
    client: ERPNextPaymentDoctypeClient,
    target: ERPNextPaymentTarget,
    input: ERPNextPaymentSubscriptionInput,
    currency: string,
    args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentPlanResult> {
    if (input.subscriptionPlan) {
      const plan = await client.getDoc(
        ERPNextPaymentDoctypes.subscriptionPlan,
        input.subscriptionPlan
      );
      const providerPlanId =
        input.providerPlanId ??
        (typeof plan.product_price_id === "string"
          ? plan.product_price_id
          : undefined);
      if (!providerPlanId)
        throw new ValidationError(
          `${this.provider} subscription plan ${input.subscriptionPlan} has no product_price_id; pass providerPlanId explicitly`
        );
      return {
        provider: this.provider,
        providerPlanId,
        plan,
        created: false,
      };
    }
    if (typeof input.amount === "undefined")
      throw new ValidationError(
        `${this.provider} recurring subscription requires either subscriptionPlan or planName with an amount`
      );
    if (!input.planName)
      throw new ValidationError(
        `${this.provider} recurring subscription requires a planName`
      );
    return this.registerRecurringPlan(
      target,
      {
        planName: input.planName,
        amount: input.amount,
        currency,
        interval: input.interval,
        intervalCount: input.intervalCount,
        providerPlanId: input.providerPlanId,
      },
      ...args
    );
  }
}
