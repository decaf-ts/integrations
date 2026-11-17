import type { MaybeContextualArg } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
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
  GoCardlessPaymentProviderConfig,
} from "./types";
import {
  compactPaymentRecord,
  fromMinorUnits,
  normalizePaymentInterval,
  toMinorUnits,
} from "./utils";

/**
 * @description GoCardless Direct Debit payment provider for ERPNext
 * @summary Implements one-off payments, mandate setup and recurring subscriptions
 * against the GoCardless REST API using mandates and redirect flows.
 * @class GoCardlessPaymentProvider
 * @category ERPNext
 * @example
 * ```typescript
 * const provider = new GoCardlessPaymentProvider();
 * await provider.initialize({ provider: "gocardless", accessToken: process.env.GC_TOKEN! });
 * const intent = await provider.createPaymentIntent({ amount: 25, mandateId: "MD123" });
 * ```
 */
export class GoCardlessPaymentProvider extends ERPNextPaymentProvider<GoCardlessPaymentProviderConfig> {
  constructor() {
    super("gocardless");
  }

  /**
   * @description GoCardless API base URL
   * @return {string} The GoCardless API base URL
   */
  protected defaultBaseUrl(): string {
    return "https://api.gocardless.com";
  }

  /**
   * @description Default ERPNext gateway name for GoCardless
   * @return {string} The gateway name
   */
  protected defaultGatewayName(): string {
    return "GoCardless";
  }

  /**
   * @description Reads GoCardless settings from the accumulated environment
   * @return {Partial<GoCardlessPaymentProviderConfig>} The environment-derived configuration
   */
  protected environmentConfig(): Partial<GoCardlessPaymentProviderConfig> {
    const base = ERPNextPaymentsEnvironment.erpnext.payments;
    const env = base.gocardless;
    return {
      accessToken: env.accessToken || undefined,
      webhookSecret: env.webhookSecret || undefined,
      version: env.version || undefined,
      baseUrl: env.baseUrl || undefined,
      currency: base.currency,
      sandbox: base.sandbox,
      timeout: base.timeout,
    } as Partial<GoCardlessPaymentProviderConfig>;
  }

  /**
   * @description Validates the GoCardless configuration
   * @summary Requires an access token.
   * @param {GoCardlessPaymentProviderConfig} config - The resolved configuration
   * @return {void}
   */
  protected validatePaymentConfig(
    config: GoCardlessPaymentProviderConfig
  ): void {
    if (!config.accessToken)
      throw new ERPNextPaymentConfigurationError(
        "GoCardless requires an accessToken"
      );
  }

  /**
   * @description Builds the GoCardless authorization headers
   * @summary Sets the bearer token and the `GoCardless-Version` header.
   * @param {GoCardlessPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, string>} The authorization headers
   */
  protected authHeaders(
    config: GoCardlessPaymentProviderConfig
  ): Record<string, string> {
    return {
      authorization: `Bearer ${config.accessToken}`,
      "gocardless-version": config.version ?? "2015-07-06",
    };
  }

  /**
   * @description Public gateway settings persisted in ERPNext
   * @param {GoCardlessPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Non-secret gateway settings
   */
  protected publicGatewaySettings(
    config: GoCardlessPaymentProviderConfig
  ): Record<string, unknown> {
    return {
      environment: config.sandbox ? "sandbox" : "live",
      version: config.version ?? "2015-07-06",
      currency: config.currency,
    };
  }

  /**
   * @description Secret gateway settings persisted in ERPNext
   * @param {GoCardlessPaymentProviderConfig} config - The resolved configuration
   * @return {Record<string, unknown>} Secret gateway settings
   */
  protected override secretGatewaySettings(
    config: GoCardlessPaymentProviderConfig
  ): Record<string, unknown> {
    return {
      accessToken: config.accessToken,
      webhookSecret: config.webhookSecret,
    };
  }

  /**
   * @description Creates a one-off GoCardless payment
   * @summary Requires a mandate id and posts a payment against it.
   * @param {ERPNextPaymentIntentInput} input - Payment intent input
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The normalized intent result
   */
  async createPaymentIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    const config = this.ensureConfigured();
    if (!input.mandateId)
      throw new ValidationError(
        "GoCardless one-off payments require a mandateId"
      );
    const currency = this.currency(input.currency, config);
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/payments",
      {
        data: {
          payments: compactPaymentRecord({
            amount: toMinorUnits(input.amount, currency),
            currency,
            description: input.description,
            reference: input.reference,
            metadata: input.metadata,
            links: { mandate: input.mandateId },
          }),
        },
      },
      ...args
    );
    const payment = raw?.payments ?? raw;
    if (!payment?.id)
      throw new ERPNextPaymentProviderError(
        "GoCardless did not return a payment identifier"
      );
    return {
      provider: this.provider,
      id: String(payment.id),
      status: String(payment.status ?? "pending"),
      approvalUrl: payment.authorisation_url,
      raw,
    };
  }

  /**
   * @description Starts a GoCardless mandate setup
   * @summary Creates a redirect flow the payer must complete to authorize the mandate.
   * @param {ERPNextPaymentIntentInput} input - Setup intent input with a `redirectUrl`
   * @param {...MaybeContextualArg<any>} args - Optional contextual arguments
   * @return {Promise<ERPNextPaymentIntentResult>} The redirect flow result
   */
  async createSetupIntent(
    input: ERPNextPaymentIntentInput,
    ...args: MaybeContextualArg<any>
  ): Promise<ERPNextPaymentIntentResult> {
    if (!input.redirectUrl)
      throw new ValidationError(
        "GoCardless mandate setup requires a redirectUrl"
      );
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/redirect_flows",
      {
        data: {
          redirect_flows: compactPaymentRecord({
            description: input.description ?? "Direct Debit mandate",
            success_redirect_url: input.redirectUrl,
            session_token: input.reference,
          }),
        },
      },
      ...args
    );
    const flow = raw?.redirect_flows ?? raw;
    if (!flow?.id)
      throw new ERPNextPaymentProviderError(
        "GoCardless did not return a redirect flow identifier"
      );
    return {
      provider: this.provider,
      id: String(flow.id),
      status: "pending",
      approvalUrl: flow.redirect_url,
      raw,
    };
  }

  /**
   * @description Derives a deterministic GoCardless plan identifier
   * @summary GoCardless has no plan resource, so the id encodes currency, amount and
   * interval; daily intervals are rejected.
   * @param {ERPNextPaymentPlanInput} input - Plan input
   * @return {Promise<string>} The derived provider plan id
   */
  async ensureProviderPlan(
    input: ERPNextPaymentPlanInput
  ): Promise<string> {
    const config = this.ensureConfigured();
    const currency = this.currency(input.currency, config);
    const interval = normalizePaymentInterval(input.interval);
    if (interval === "Day")
      throw new ValidationError(
        "GoCardless recurring plans support weekly, monthly or yearly intervals"
      );
    return `gocardless:${currency}:${toMinorUnits(input.amount, currency)}:${interval.toLowerCase()}:${input.intervalCount ?? 1}`;
  }

  /**
   * @description Creates a recurring GoCardless subscription
   * @summary Requires a mandate and posts a subscription with the normalized interval
   * unit; daily intervals are rejected.
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
    await Promise.resolve();
    if (!input.mandateId)
      throw new ValidationError(
        "GoCardless recurring subscriptions require a mandateId"
      );
    const interval = normalizePaymentInterval(input.interval);
    if (interval === "Day")
      throw new ValidationError(
        "GoCardless recurring subscriptions support weekly, monthly or yearly intervals"
      );
    const intervalUnit = interval === "Year" ? "yearly" : `${interval.toLowerCase()}ly`;
    const raw = await this.request<Record<string, any>>(
      "POST",
      "/subscriptions",
      {
        data: {
          subscriptions: compactPaymentRecord({
            amount: toMinorUnits(input.amount, input.currency),
            currency: input.currency,
            interval_unit: intervalUnit,
            interval: (input.intervalCount ?? 1) > 1 ? input.intervalCount : undefined,
            name: input.reference,
            metadata: input.metadata,
            links: { mandate: input.mandateId },
          }),
        },
      },
      ...args
    );
    const subscription = raw?.subscriptions ?? raw;
    if (!subscription?.id)
      throw new ERPNextPaymentProviderError(
        "GoCardless did not return a subscription identifier"
      );
    return { id: String(subscription.id), raw };
  }

  /**
   * @description Normalizes GoCardless webhook events
   * @summary Maps payment and subscription actions to normalized statuses and ERPNext
   * actions.
   * @param {unknown} payload - The raw webhook envelope
   * @return {ERPNextPaymentWebhookEvent[]} The normalized events
   */
  parseWebhook(payload: unknown): ERPNextPaymentWebhookEvent[] {
    const envelope = payload as { events?: unknown[] };
    const entries = Array.isArray(payload)
      ? payload
      : Array.isArray(envelope?.events)
        ? envelope.events
        : payload && typeof payload === "object" &&
            ("resource_type" in (payload as Record<string, unknown>) ||
              "action" in (payload as Record<string, unknown>))
          ? [payload]
          : [];
    return entries.reduce((accum, entry) => {
      if (!entry || typeof entry !== "object") return accum;
      const event = entry as Record<string, any>;
      const action = String(event.action ?? "").toLowerCase();
      const resourceType = String(event.resource_type ?? "").toLowerCase();
      const type = `${resourceType}.${action}`.replace(/^\./, "");
      if (!type || type === ".") return accum;
      const links = (event.links ?? {}) as Record<string, unknown>;
      const details = (event.details ?? {}) as Record<string, any>;
      const currency =
        typeof details.currency === "string"
          ? details.currency.toUpperCase()
          : undefined;
      let status: ERPNextPaymentWebhookEvent["status"] = "unknown";
      let actions: ERPNextPaymentWebhookEvent["actions"] = ["ignore"];
      if (resourceType === "payments") {
        if (["paid_out", "confirmed", "approved"].includes(action)) {
          status = "succeeded";
          actions = ["mark-paid"];
        } else if (["failed", "charged_back", "cancelled"].includes(action)) {
          status = "failed";
          actions = ["mark-failed"];
        } else if (["created", "pending", "submitted"].includes(action)) {
          status = "pending";
        }
      } else if (resourceType === "subscriptions") {
        if (["created", "confirmed", "resumed"].includes(action)) {
          status = "active";
          actions = ["activate-subscription"];
        } else if (["cancelled", "finished"].includes(action)) {
          status = "cancelled";
          actions = ["cancel-subscription"];
        } else if (action === "paused") {
          status = "pending";
        }
      }
      accum.push({
        provider: this.provider,
        id: typeof event.id === "string" ? event.id : undefined,
        type,
        status,
        paymentId:
          typeof links.payment === "string" ? links.payment : undefined,
        subscriptionId:
          typeof links.subscription === "string"
            ? links.subscription
            : undefined,
        amount:
          typeof details.amount === "number"
            ? fromMinorUnits(details.amount, currency)
            : undefined,
        currency,
        actions,
        raw: entry,
      });
      return accum;
    }, [] as ERPNextPaymentWebhookEvent[]);
  }
}
