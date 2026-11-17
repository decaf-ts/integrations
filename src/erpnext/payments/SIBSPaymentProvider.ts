import type { MaybeContextualArg } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import { ERPNextPaymentsEnvironment } from "./environment";
import {
  ERPNextPaymentAuthenticationError,
  ERPNextPaymentConfigurationError,
  ERPNextPaymentProviderError,
  parsePaymentProviderError,
} from "./errors";
import { ERPNextPaymentProvider } from "./ERPNextPaymentProvider";
import type {
  ERPNextPaymentIntentInput,
  ERPNextPaymentIntentResult,
  ERPNextPaymentPlanInput,
  ERPNextPaymentSubscriptionInput,
  ERPNextPaymentWebhookEvent,
  SIBSPaymentProviderConfig,
} from "./types";
import {
  compactPaymentRecord,
  fromMinorUnits,
  paymentIntervalUnit,
  toMinorUnits,
  toPaymentFormBody,
} from "./utils";

/**
 * @description SIBS payment provider for ERPNext
 * @summary Implements card and MB WAY payments, payment-method tokenization and
 * recurring subscriptions against the SIBS gateway, caching OAuth access tokens
 * obtained from client credentials.
 * @class SIBSPaymentProvider
 * @category ERPNext
 * @example
 * ```typescript
 * const provider = new SIBSPaymentProvider();
 * await provider.initialize({ provider: "sibs", merchantId: "12345", clientId: "id", clientSecret: "secret" });
 * const intent = await provider.createPaymentIntent({ amount: 30 });
 * ```
 */
export class SIBSPaymentProvider extends ERPNextPaymentProvider<SIBSPaymentProviderConfig> {
  private _accessToken?: string;
  private _tokenExpiresAt = 0;

  constructor() {
    super("sibs");
  }

  /**
   * @description SIBS gateway API base URL
   * @return {string} The SIBS API base URL
   */
  protected defaultBaseUrl(): string {
    return "https://api.sibs.pt/gateway/v1";
  }

  /**
   * @description Default ERPNext gateway name for SIBS
   * @return {string} The gateway name
   */
  protected defaultGatewayName(): string {
    return "SIBS";
  }

  /**
   * @description Reads SIBS settings from the accumulated environment
   * @return {Partial<SIBSPaymentProviderConfig>} The environment-derived configuration
   */
  protected environmentConfig(): Partial<SIBSPaymentProviderConfig> {
    const base = ERPNextPaymentsEnvironment.erpnext.payments;
    const env = base.sibs;
    return {
      merchantId: env.merchantId || undefined,
      terminalId: env.terminalId || undefined,
      entityId: env.entityId || undefined,
      clientId: env.clientId || undefined,
      clientSecret: env.clientSecret || undefined,
      accessToken: env.accessToken || undefined,
      mbwayEnabled: env.mbwayEnabled,
      baseUrl: env.baseUrl || undefined,
      currency: base.currency,
      sandbox: base.sandbox,
      timeout: base.timeout,
    } as Partial<SIBSPaymentProviderConfig>;
  }

  /**
   * @description Validates the SIBS configuration
   * @summary Requires a merchant id and either an access token or client credentials.
   * @param {SIBSPaymentProviderConfig} config - The resolved configuration
   * @return {void}
   */
  protected validatePaymentConfig(config: SIBSPaymentProviderConfig): void {
    if (!config.merchantId)
      throw new ERPNextPaymentConfigurationError(
        "SIBS requires a merchantId"
      );
    if (
      !config.accessToken &&
      !(config.clientId && config.clientSecret)
    )
      throw new ERPNextPaymentConfigurationError(
        "SIBS requires accessToken or clientId/clientSecret"
      );
  }

  /**
   * @description Builds the SIBS authorization headers
   * @summary Uses the configured access token or obtains one through
   * {@link ensureAccessToken}.
   * @param {SIBSPaymentProviderConfig} config - The resolved configuration
   * @return {Promise<Record<string, string>>} The bearer authorization header
   */
  protected async authHeaders(
    config: SIBSPaymentProviderConfig
  ): Promise<Record<string, string>> {
    const token = config.accessToken ?? (await this.ensureAccessToken(config));
    return { authorization: `Bearer ${token}` };
  }

  /**
   * @description Public gateway settings persisted in ERPNext
   * @param {SIBSPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Non-secret gateway settings
   */
  protected publicGatewaySettings(
    config: SIBSPaymentProviderConfig
  ): Record<string, unknown> {
    return {
      merchantId: config.merchantId,
      terminalId: config.terminalId,
      entityId: config.entityId,
      mbwayEnabled: config.mbwayEnabled,
      currency: config.currency,
      sandbox: config.sandbox,
    };
  }

  /**
   * @description Secret gateway settings persisted in ERPNext
   * @param {SIBSPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Secret gateway settings
   */
  protected override secretGatewaySettings(
    config: SIBSPaymentProviderConfig
  ): Record<string, unknown> {
    return {
      accessToken: config.accessToken,
      clientSecret: config.clientSecret,
      webhookSecret: config.webhookSecret,
    };
  }

  /**
   * @description Creates a SIBS card or MB WAY payment intent
   * @summary Selects the payment method from the input or the MB WAY configuration and
   * requires a phone number for MB WAY payments.
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
    const paymentMethod =
      input.paymentMethod ?? (config.mbwayEnabled ? "MBWAY" : "CARD");
    if (paymentMethod.toUpperCase() === "MBWAY" && !input.phoneNumber)
      throw new ValidationError(
        "SIBS MBWAY payments require the payer phoneNumber"
      );
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/payments",
      {
        data: compactPaymentRecord({
          merchantId: config.merchantId,
          terminalId: config.terminalId,
          entityId: config.entityId,
          amount: toMinorUnits(input.amount, currency),
          currency,
          paymentMethod: paymentMethod.toUpperCase(),
          phoneNumber: input.phoneNumber,
          orderId: input.order ?? input.reference,
          description: input.description,
          customerId: input.customer,
          metadata: input.metadata,
        }),
      },
      ...args
    );
    return this.intentResult(raw);
  }

  /**
   * @description Creates a SIBS MB WAY payment intent
   * @summary Convenience wrapper that forces the `MBWAY` payment method.
   * @param {ERPNextPaymentIntentInput} input - Payment intent input with a phone number
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  async createMBWAYPayment(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    return this.createPaymentIntent(
      { ...input, paymentMethod: "MBWAY" },
      ...args
    );
  }

  /**
   * @description Tokenizes a SIBS payment method
   * @summary Registers a card or MB WAY payment method so it can be reused for
   * subscriptions.
   * @param {ERPNextPaymentIntentInput} input - Setup intent input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  async createSetupIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    const config = this.ensureConfigured();
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/payment-methods",
      {
        data: compactPaymentRecord({
          merchantId: config.merchantId,
          customerId: input.customer,
          paymentMethod: input.paymentMethod ?? "CARD",
          phoneNumber: input.phoneNumber,
          metadata: input.metadata,
        }),
      },
      ...args
    );
    return this.intentResult(raw);
  }

  /**
   * @description Creates or resolves a SIBS subscription plan
   * @summary Posts a plan with the normalized amount, currency and interval and returns
   * its provider id.
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
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/subscriptions/plans",
      {
        data: compactPaymentRecord({
          merchantId: config.merchantId,
          name: input.planName,
          amount: toMinorUnits(input.amount, currency),
          currency,
          interval: paymentIntervalUnit(input.interval),
          intervalCount: input.intervalCount ?? 1,
          description: input.description,
        }),
      },
      ...args
    );
    if (!raw?.id && !raw?.planId)
      throw new ERPNextPaymentProviderError(
        "SIBS did not return a plan identifier"
      );
    return String(raw.id ?? raw.planId);
  }

  /**
   * @description Creates a SIBS recurring subscription
   * @summary Links the provider plan to a customer payment method and returns the
   * provider subscription id.
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
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/subscriptions",
      {
        data: compactPaymentRecord({
          merchantId: config.merchantId,
          planId: input.providerPlanId,
          amount: toMinorUnits(input.amount, input.currency),
          currency: input.currency,
          customerId: input.customer,
          paymentMethodToken: input.paymentMethodToken,
          externalReference: input.reference,
          startDate: input.startDate,
          metadata: input.metadata,
        }),
      },
      ...args
    );
    if (!raw?.id && !raw?.subscriptionId)
      throw new ERPNextPaymentProviderError(
        "SIBS did not return a subscription identifier"
      );
    return { id: String(raw.id ?? raw.subscriptionId), raw };
  }

  /**
   * @description Normalizes SIBS webhook notifications
   * @summary Maps payment, tokenization and subscription responses to normalized
   * statuses and ERPNext actions.
   * @param {unknown} payload - The raw webhook payload
   * @return {ERPNextPaymentWebhookEvent[]} The normalized events
   */
  parseWebhook(payload: unknown): ERPNextPaymentWebhookEvent[] {
    const entries = Array.isArray(payload) ? payload : [payload];
    return entries.reduce((accum, entry) => {
      if (!entry || typeof entry !== "object") return accum;
      const event = entry as Record<string, any>;
      const type = String(
        event.type ?? event.eventType ?? event.event ?? ""
      );
      if (!type) return accum;
      const normalized = type.toLowerCase();
      let status: ERPNextPaymentWebhookEvent["status"] = "unknown";
      let actions: ERPNextPaymentWebhookEvent["actions"] = ["ignore"];
      if (
        normalized.includes("succeeded") ||
        normalized.includes("paid") ||
        normalized.includes("completed")
      ) {
        status = "succeeded";
        actions = ["mark-paid"];
      } else if (
        normalized.includes("failed") ||
        normalized.includes("declined") ||
        normalized.includes("error")
      ) {
        status = "failed";
        actions = ["mark-failed"];
      } else if (
        normalized.includes("pending") ||
        normalized.includes("processing")
      ) {
        status = "pending";
      } else if (
        normalized.includes("subscription") &&
        (normalized.includes("active") || normalized.includes("created"))
      ) {
        status = "active";
        actions = ["activate-subscription"];
      } else if (
        normalized.includes("cancelled") ||
        normalized.includes("canceled")
      ) {
        status = "cancelled";
        actions = ["cancel-subscription"];
      }
      const currency =
        typeof event.currency === "string"
          ? event.currency.toUpperCase()
          : undefined;
      accum.push({
        provider: this.provider,
        id: typeof event.id === "string" ? event.id : undefined,
        type,
        status,
        paymentId:
          typeof (event.paymentId ?? event.transactionId ?? event.id) ===
          "string"
            ? String(event.paymentId ?? event.transactionId ?? event.id)
            : undefined,
        subscriptionId:
          typeof event.subscriptionId === "string"
            ? event.subscriptionId
            : undefined,
        amount:
          typeof event.amount === "number"
            ? fromMinorUnits(event.amount, currency)
            : undefined,
        currency,
        actions,
        raw: entry,
      });
      return accum;
    }, [] as ERPNextPaymentWebhookEvent[]);
  }

  /**
   * @description Obtains and caches a SIBS OAuth access token
   * @summary Uses the cached token while valid, otherwise requests a client-credentials
   * token from the SIBS token endpoint.
   * @param {SIBSPaymentProviderConfig} config - The resolved configuration
   * @return {Promise<string>} The access token
   */
  private async ensureAccessToken(
    config: SIBSPaymentProviderConfig
  ): Promise<string> {
    if (this._accessToken && this._tokenExpiresAt > Date.now())
      return this._accessToken;
    if (!config.clientId || !config.clientSecret)
      throw new ERPNextPaymentAuthenticationError(
        "SIBS requires accessToken or clientId/clientSecret"
      );
    const response = await this.client({
      method: "POST",
      url: this.absoluteUrl("/oauth/token"),
      headers: {
        ...(config.headers ?? {}),
        "content-type": "application/x-www-form-urlencoded",
      },
      data: toPaymentFormBody({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      timeout: config.timeout,
    });
    if (response.status < 200 || response.status >= 300)
      throw parsePaymentProviderError(
        this.provider,
        response.status,
        response.data
      );
    const token = response.data?.access_token ?? response.data?.accessToken;
    if (!token)
      throw new ERPNextPaymentAuthenticationError(
        "SIBS token endpoint did not return an access token"
      );
    this._accessToken = String(token);
    const expiresIn = Number(response.data?.expires_in ?? 3600);
    this._tokenExpiresAt = Date.now() + Math.max(expiresIn - 30, 0) * 1000;
    return this._accessToken;
  }

  /**
   * @description Maps a SIBS response to the normalized intent result
   * @param {Record<string, any>} raw - The raw provider response
   * @return {ERPNextPaymentIntentResult} The normalized intent result
   */
  private intentResult(
    raw: Record<string, any>
  ): ERPNextPaymentIntentResult {
    const id = raw?.paymentId ?? raw?.id ?? raw?.transactionId;
    if (!id)
      throw new ERPNextPaymentProviderError(
        "SIBS did not return a payment identifier"
      );
    return {
      provider: this.provider,
      id: String(id),
      status: String(raw.status ?? raw.paymentStatus ?? "unknown"),
      clientSecret: raw.clientSecret,
      approvalUrl: raw.paymentUrl ?? raw.redirectUrl ?? raw.approvalUrl,
      raw,
    };
  }
}
