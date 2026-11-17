import type { MaybeContextualArg } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import { ERPNextPaymentsEnvironment } from "./environment";
import {
  ERPNextPaymentConfigurationError,
  ERPNextPaymentProviderError,
} from "./errors";
import { ERPNextPaymentProvider } from "./ERPNextPaymentProvider";
import type {
  BizumPaymentProviderConfig,
  ERPNextPaymentIntentInput,
  ERPNextPaymentIntentResult,
  ERPNextPaymentPlanInput,
  ERPNextPaymentSubscriptionInput,
  ERPNextPaymentWebhookEvent,
} from "./types";
import {
  compactPaymentRecord,
  fromMinorUnits,
  normalizePaymentInterval,
  paymentBase64Json,
  toMinorUnits,
} from "./utils";

const BizumCurrencyCodes: Record<string, string> = {
  EUR: "978",
  USD: "840",
  GBP: "826",
  CHF: "756",
  SEK: "752",
  NOK: "578",
  DKK: "208",
  PLN: "985",
  BRL: "986",
};

const BizumCurrencyNames: Record<string, string> = Object.entries(
  BizumCurrencyCodes
).reduce(
  (accum, [name, code]) => {
    accum[code] = name;
    return accum;
  },
  {} as Record<string, string>
);

/**
 * @description Bizum (Redsys) payment provider for ERPNext
 * @summary Implements payment intents, tokenization and recurring subscriptions
 * against the Redsys REST API, signing merchant parameters through a configured
 * {@link ERPNextPaymentSignatureProvider}.
 * @class BizumPaymentProvider
 * @category ERPNext
 * @example
 * ```typescript
 * const provider = new BizumPaymentProvider();
 * await provider.initialize({ provider: "bizum", merchantCode: "999008881", terminal: "1" });
 * const intent = await provider.createPaymentIntent({ amount: 12.5, phoneNumber: "+34600000000" });
 * ```
 */
export class BizumPaymentProvider extends ERPNextPaymentProvider<BizumPaymentProviderConfig> {
  constructor() {
    super("bizum");
  }

  /**
   * @description Resolves the Redsys REST base URL
   * @summary Uses the configured base URL or falls back to the Redsys sandbox/production
   * endpoint depending on the `sandbox` flag.
   * @return {string} The Redsys REST base URL
   */
  protected defaultBaseUrl(config?: BizumPaymentProviderConfig): string {
    const fallback =
      config?.sandbox === false
        ? "https://sis.redsys.es:25443/sis/rest"
        : "https://sis-t.redsys.es:25443/sis/rest";
    return ERPNextPaymentsEnvironment.erpnext.payments.bizum.baseUrl || fallback;
  }

  /**
   * @description Default ERPNext gateway name for Bizum
   * @return {string} The gateway name
   */
  protected defaultGatewayName(): string {
    return "Bizum";
  }

  /**
   * @description Reads Bizum settings from the accumulated environment
   * @return {Partial<BizumPaymentProviderConfig>} The environment-derived configuration
   */
  protected environmentConfig(): Partial<BizumPaymentProviderConfig> {
    const base = ERPNextPaymentsEnvironment.erpnext.payments;
    const env = base.bizum;
    return {
      merchantCode: env.merchantCode || undefined,
      terminal: env.terminal || undefined,
      apiKey: env.apiKey || undefined,
      webhookSecret: env.webhookSecret || undefined,
      baseUrl: env.baseUrl || undefined,
      currency: base.currency,
      sandbox: base.sandbox,
      timeout: base.timeout,
    } as Partial<BizumPaymentProviderConfig>;
  }

  /**
   * @description Validates the Bizum merchant configuration
   * @summary Requires a merchant code, terminal and either an API key or a custom
   * signature provider.
   * @param {BizumPaymentProviderConfig} config - The resolved configuration
   * @return {void}
   */
  protected validatePaymentConfig(config: BizumPaymentProviderConfig): void {
    if (!config.merchantCode)
      throw new ERPNextPaymentConfigurationError(
        "Bizum requires a merchantCode (Redsys FUC)"
      );
    if (!config.terminal)
      throw new ERPNextPaymentConfigurationError(
        "Bizum requires a terminal identifier"
      );
    if (!config.apiKey && !config.signatureProvider)
      throw new ERPNextPaymentConfigurationError(
        "Bizum requires apiKey or signatureProvider"
      );
  }

  /**
   * @description Builds the Bizum authorization headers
   * @param {BizumPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, string>} Bearer authorization header when an API key is set
   */
  protected authHeaders(
    config: BizumPaymentProviderConfig
  ): Record<string, string> {
    return config.apiKey
      ? { authorization: `Bearer ${config.apiKey}` }
      : {};
  }

  /**
   * @description Public gateway settings persisted in ERPNext
   * @param {BizumPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Non-secret gateway settings
   */
  protected publicGatewaySettings(
    config: BizumPaymentProviderConfig
  ): Record<string, unknown> {
    return {
      merchantCode: config.merchantCode,
      terminal: config.terminal,
      currency: config.currency,
      sandbox: config.sandbox,
    };
  }

  /**
   * @description Secret gateway settings persisted in ERPNext
   * @param {BizumPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Secret gateway settings
   */
  protected override secretGatewaySettings(
    config: BizumPaymentProviderConfig
  ): Record<string, unknown> {
    return {
      apiKey: config.apiKey,
      webhookSecret: config.webhookSecret,
    };
  }

  /**
   * @description Creates a one-off Bizum payment intent
   * @summary Signs and submits a Redsys merchant payment request, including the
   * optional customer mobile number.
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
    const order = this.orderNumber(input.order ?? input.reference);
    const parameters = {
      DS_MERCHANT_AMOUNT: String(toMinorUnits(input.amount, currency)),
      DS_MERCHANT_ORDER: order,
      DS_MERCHANT_MERCHANTCODE: config.merchantCode,
      DS_MERCHANT_TERMINAL: config.terminal,
      DS_MERCHANT_CURRENCY: BizumCurrencyCodes[currency] ?? "978",
      DS_MERCHANT_TRANSACTIONTYPE: "0",
      DS_MERCHANT_GROUP: "Bizum",
      DS_MERCHANT_CONSUMERLANGUAGE: "002",
      DS_MERCHANT_URLOK: input.redirectUrl,
      DS_MERCHANT_URLKO: input.redirectUrl,
      ...(input.phoneNumber
        ? { DS_MERCHANT_CUSTOMER_MOBILE: input.phoneNumber }
        : {}),
    };
    const raw = await this.signedRequest("/trataPeticionREST", parameters, ...args);
    return this.intentResult(raw, order);
  }

  /**
   * @description Tokenizes a payment method for recurring use
   * @summary Submits a Redsys tokenization request so later subscriptions can reuse the
   * merchant identifier.
   * @param {ERPNextPaymentIntentInput} input - Setup intent input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  async createSetupIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    const config = this.ensureConfigured();
    const currency = this.currency(input.currency, config);
    const order = this.orderNumber(input.order ?? input.reference);
    const parameters = {
      DS_MERCHANT_AMOUNT: String(toMinorUnits(input.amount, currency)),
      DS_MERCHANT_ORDER: order,
      DS_MERCHANT_MERCHANTCODE: config.merchantCode,
      DS_MERCHANT_TERMINAL: config.terminal,
      DS_MERCHANT_CURRENCY: BizumCurrencyCodes[currency] ?? "978",
      DS_MERCHANT_TRANSACTIONTYPE: "0",
      DS_MERCHANT_EXCEP_SCA: "TOKEN",
      ...(input.phoneNumber
        ? { DS_MERCHANT_CUSTOMER_MOBILE: input.phoneNumber }
        : {}),
    };
    const raw = await this.signedRequest("/tokenizacion", parameters, ...args);
    return this.intentResult(raw, order);
  }

  /**
   * @description Derives a deterministic Bizum plan identifier
   * @summary Bizum has no plan resource, so the id encodes merchant, currency, amount
   * and interval.
   * @param {ERPNextPaymentPlanInput} input - Plan input
   * @return {Promise<string>} The derived provider plan id
   */
  async ensureProviderPlan(
    input: ERPNextPaymentPlanInput
  ): Promise<string> {
    const config = this.ensureConfigured();
    const currency = this.currency(input.currency, config);
    const interval = normalizePaymentInterval(input.interval);
    return `bizum:${config.merchantCode}:${currency}:${toMinorUnits(input.amount, currency)}:${interval.toLowerCase()}:${input.intervalCount ?? 1}`;
  }

  /**
   * @description Creates a recurring Bizum subscription
   * @summary Requires a payment method token or mandate and submits an MIT recurring
   * Redsys request.
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
    if (!input.paymentMethodToken && !input.mandateId)
      throw new ValidationError(
        "Bizum recurring subscriptions require a paymentMethodToken or mandateId"
      );
    const config = this.ensureConfigured();
    const order = this.orderNumber(input.reference);
    const interval = normalizePaymentInterval(input.interval);
    const parameters = {
      DS_MERCHANT_AMOUNT: String(toMinorUnits(input.amount, input.currency)),
      DS_MERCHANT_ORDER: order,
      DS_MERCHANT_MERCHANTCODE: config.merchantCode,
      DS_MERCHANT_TERMINAL: config.terminal,
      DS_MERCHANT_CURRENCY: BizumCurrencyCodes[input.currency] ?? "978",
      DS_MERCHANT_TRANSACTIONTYPE: "R",
      DS_MERCHANT_EXCEP_SCA: "MIT",
      DS_MERCHANT_IDENTIFIER:
        input.paymentMethodToken ?? input.mandateId,
      DS_MERCHANT_IDENTIFIER_TYPE: "1",
      DS_MERCHANT_PERIODICITY: interval,
      DS_MERCHANT_PERIODICITY_COUNT: String(input.intervalCount ?? 1),
    };
    const raw = await this.signedRequest("/trataPeticionREST", parameters, ...args);
    const id =
      raw?.subscriptionId ??
      raw?.Ds_Merchant_Identifier ??
      raw?.Ds_Order ??
      raw?.orderId ??
      order;
    return { id: String(id), raw };
  }

  /**
   * @description Normalizes Redsys webhook notifications
   * @summary Maps payment and subscription responses to normalized events and ERPNext
   * actions such as `mark-paid` or `activate-subscription`.
   * @param {unknown} payload - The raw webhook payload
   * @return {ERPNextPaymentWebhookEvent[]} The normalized events
   */
  parseWebhook(payload: unknown): ERPNextPaymentWebhookEvent[] {
    const entries = Array.isArray(payload) ? payload : [payload];
    return entries.reduce((accum, entry) => {
      if (!entry || typeof entry !== "object") return accum;
      const event = entry as Record<string, any>;
      const rawType = event.type ?? event.eventType;
      const subscriptionId =
        typeof event.subscriptionId === "string"
          ? event.subscriptionId
          : undefined;
      const responseSource =
        event.Ds_Response ?? event.responseCode ?? event.code;
      const hasResponseCode =
        responseSource !== undefined &&
        responseSource !== null &&
        String(responseSource).trim() !== "";
      if (!rawType && !hasResponseCode && !subscriptionId) return accum;
      const type = String(
        rawType ??
          event.Ds_Response_Description ??
          (subscriptionId ? "subscription" : "payment")
      );
      const responseCode = hasResponseCode
        ? String(responseSource).padStart(4, "0")
        : "";
      const numeric = Number(responseCode);
      const currencyCode = String(
        event.Ds_Currency ?? event.currency ?? ""
      );
      const currency = /^[A-Za-z]{3}$/.test(currencyCode)
        ? currencyCode.toUpperCase()
        : BizumCurrencyNames[currencyCode];
      const amount = Number(
        event.Ds_Amount ?? event.amount ?? Number.NaN
      );
      let status: ERPNextPaymentWebhookEvent["status"] = "unknown";
      let actions: ERPNextPaymentWebhookEvent["actions"] = ["ignore"];
      if (type.toLowerCase().includes("subscription")) {
        if (type.toLowerCase().includes("cancel")) {
          status = "cancelled";
          actions = ["cancel-subscription"];
        } else {
          status = "active";
          actions = ["activate-subscription"];
        }
      } else if (
        hasResponseCode &&
        Number.isFinite(numeric) &&
        numeric >= 0 &&
        numeric <= 99
      ) {
        status = "succeeded";
        actions = ["mark-paid"];
      } else if (responseCode) {
        status = "failed";
        actions = ["mark-failed"];
      }
      accum.push({
        provider: this.provider,
        id: typeof event.id === "string" ? event.id : undefined,
        type,
        status,
        paymentId:
          typeof (event.Ds_Order ?? event.orderId ?? event.paymentId) ===
          "string"
            ? String(event.Ds_Order ?? event.orderId ?? event.paymentId)
            : undefined,
        subscriptionId:
          typeof event.subscriptionId === "string"
            ? event.subscriptionId
            : undefined,
        amount: Number.isFinite(amount)
          ? fromMinorUnits(amount, currency)
          : undefined,
        currency,
        actions,
        raw: entry,
      });
      return accum;
    }, [] as ERPNextPaymentWebhookEvent[]);
  }

  /**
   * @description Signs and posts merchant parameters to Redsys
   * @summary Builds the `Ds_MerchantParameters` payload, requests a signature and posts
   * the signed request as a form body.
   * @param {string} path - The Redsys REST path
   * @param {Record<string, unknown>} parameters - The merchant parameters
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<Record<string, any>>} The raw provider response
   */
  private async signedRequest(
    path: string,
    parameters: Record<string, unknown>,
    ...args: MaybeContextualArg<any>
  ): Promise<Record<string, any>> {
    const config = this.ensureConfigured();
    if (!config.signatureProvider)
      throw new ERPNextPaymentConfigurationError(
        "Bizum requires signatureProvider to sign Redsys merchant parameters"
      );
    const signature = await config.signatureProvider(
      compactPaymentRecord(parameters)
    );
    const value = signature.Ds_Signature ?? signature.signature;
    if (!value)
      throw new ERPNextPaymentConfigurationError(
        "Bizum signatureProvider must return Ds_Signature (or signature)"
      );
    return this.request<Record<string, any>>(
      "POST",
      path,
      {
        encoding: "form",
        data: compactPaymentRecord({
          Ds_SignatureVersion:
            signature.Ds_SignatureVersion ??
            signature.signatureVersion ??
            "HMAC_SHA256_V1",
          Ds_MerchantParameters: paymentBase64Json(
            compactPaymentRecord(parameters)
          ),
          Ds_Signature: value,
        }),
      },
      ...args
    );
  }

  /**
   * @description Normalizes a Redsys order number
   * @summary Keeps a valid 4-12 alphanumeric seed or derives one from the current time.
   * @param {string} [seed] - Candidate order number
   * @return {string} The normalized order number
   */
  private orderNumber(seed?: string): string {
    const base =
      seed && /^[0-9A-Za-z]{4,12}$/.test(seed)
        ? seed
        : Date.now().toString().slice(-12);
    return base.padStart(4, "0").slice(0, 12);
  }

  /**
   * @description Maps a Redsys response to the normalized intent result
   * @summary Derives the payment id, status, client secret and approval URL from the
   * Redsys response codes.
   * @param {Record<string, any>} raw - The raw provider response
   * @param {string} order - The order number used for the request
   * @return {ERPNextPaymentIntentResult} The normalized intent result
   */
  private intentResult(
    raw: Record<string, any>,
    order: string
  ): ERPNextPaymentIntentResult {
    const id = raw?.paymentId ?? raw?.Ds_Order ?? raw?.orderId ?? order;
    if (!id)
      throw new ERPNextPaymentProviderError(
        "Bizum did not return a payment identifier"
      );
    const code = String(raw?.Ds_Response ?? raw?.responseCode ?? "").padStart(
      4,
      "0"
    );
    const numeric = Number(code);
    const status =
      raw?.status ??
      (Number.isFinite(numeric) && numeric >= 0 && numeric <= 99
        ? "succeeded"
        : code
          ? "failed"
          : "pending");
    return {
      provider: this.provider,
      id: String(id),
      status: String(status),
      clientSecret:
        raw?.Ds_Merchant_Identifier ?? raw?.merchantIdentifier,
      approvalUrl: raw?.Ds_Url ?? raw?.redirectUrl,
      raw,
    };
  }
}
