import type { ERPNextPaymentProviderKeys } from "./constants";

/**
 * @description Supported ERPNext payment provider key
 * @summary Union of the identifiers listed in {@link ERPNextPaymentProviderKeys}.
 * @typedef {object} ERPNextPaymentProviderKey
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentProviderKey =
  (typeof ERPNextPaymentProviderKeys)[number];

/**
 * @description Normalized subscription billing interval
 * @summary Interval unit understood by every payment provider.
 * @typedef {object} ERPNextPaymentInterval
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentInterval = "Day" | "Week" | "Month" | "Year";

/**
 * @description HTTP verb used by payment provider requests
 * @summary Subset of HTTP methods accepted by the payment transport.
 * @typedef {object} ERPNextPaymentHttpMethod
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

/**
 * @description Payment request body encoding
 * @summary Selects JSON or form-url-encoded serialization.
 * @typedef {object} ERPNextPaymentBodyEncoding
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentBodyEncoding = "json" | "form";

/**
 * @description Payment provider HTTP request descriptor
 * @summary Normalized request handed to an {@link ERPNextPaymentTransport}.
 * @interface ERPNextPaymentHttpRequest
 * @property {ERPNextPaymentHttpMethod} method HTTP verb
 * @property {string} url Fully-qualified request URL
 * @property {Record<string, string>} [headers] Request headers
 * @property {unknown} [data] Request body
 * @property {number} [timeout] Request timeout in milliseconds
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentHttpRequest {
  method: ERPNextPaymentHttpMethod;
  url: string;
  headers?: Record<string, string>;
  data?: unknown;
  timeout?: number;
}

/**
 * @description Payment provider HTTP response descriptor
 * @summary Minimal response shape returned by the transport.
 * @interface ERPNextPaymentHttpResponse
 * @property {number} status HTTP status code
 * @property {any} data Parsed response body
 * @property {Record<string, string>} [headers] Response headers
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentHttpResponse {
  status: number;
  data: any;
  headers?: Record<string, string>;
}

/**
 * @description Payment provider HTTP transport
 * @summary Function that performs a single provider request; injectable for testing or custom networking.
 * @typedef {object} ERPNextPaymentTransport
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentTransport = (
  request: ERPNextPaymentHttpRequest
) => Promise<ERPNextPaymentHttpResponse>;

/**
 * @description Payment request signature provider
 * @summary Produces the signature headers required by providers such as Bizum.
 * @typedef {object} ERPNextPaymentSignatureProvider
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentSignatureProvider = (
  parameters: Record<string, unknown>
) => Promise<Record<string, string>> | Record<string, string>;

/**
 * @description Payment webhook verifier
 * @summary Validates a webhook payload against its signature.
 * @typedef {object} ERPNextPaymentWebhookVerifier
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentWebhookVerifier = (
  payload: unknown,
  signature?: string
) => Promise<boolean> | boolean;

/**
 * @description Base payment provider configuration
 * @summary Common options shared by every provider implementation.
 * @interface ERPNextPaymentProviderConfig
 * @property {ERPNextPaymentProviderKey} provider The selected provider key
 * @property {string} [baseUrl] Provider API base URL
 * @property {string} [currency] Default currency
 * @property {number} [timeout] Request timeout in milliseconds
 * @property {Record<string, string>} [headers] Default request headers
 * @property {ERPNextPaymentTransport} [transport] Custom HTTP transport
 * @property {string} [gatewayName] ERPNext payment gateway name
 * @property {boolean} [sandbox] Use the provider sandbox
 * @property {string} [webhookSecret] Webhook signing secret
 * @property {ERPNextPaymentWebhookVerifier} [webhookVerifier] Custom webhook verifier
 * @property {string} [item] ERPNext item used for plan lines
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentProviderConfig {
  provider: ERPNextPaymentProviderKey;
  baseUrl?: string;
  currency?: string;
  timeout?: number;
  headers?: Record<string, string>;
  transport?: ERPNextPaymentTransport;
  gatewayName?: string;
  sandbox?: boolean;
  webhookSecret?: string;
  webhookVerifier?: ERPNextPaymentWebhookVerifier;
  item?: string;
}

/**
 * @description Minimal Stripe payment intents SDK surface
 * @summary Structural type of the Stripe `paymentIntents` resource used by the adapter.
 * @interface StripeSdkPaymentIntents
 * @property {function} create Creates a payment intent
 * @memberOf module:erpnext/payments
 */
export interface StripeSdkPaymentIntents {
  create(params: Record<string, unknown>): Promise<Record<string, any>>;
}

/**
 * @description Minimal Stripe setup intents SDK surface
 * @summary Structural type of the Stripe `setupIntents` resource.
 * @interface StripeSdkSetupIntents
 * @property {function} create Creates a setup intent
 * @memberOf module:erpnext/payments
 */
export interface StripeSdkSetupIntents {
  create(params: Record<string, unknown>): Promise<Record<string, any>>;
}

/**
 * @description Minimal Stripe plans SDK surface
 * @summary Structural type of the Stripe `plans` resource.
 * @interface StripeSdkPlans
 * @property {function} create Creates a plan
 * @memberOf module:erpnext/payments
 */
export interface StripeSdkPlans {
  create(params: Record<string, unknown>): Promise<Record<string, any>>;
}

/**
 * @description Minimal Stripe subscriptions SDK surface
 * @summary Structural type of the Stripe `subscriptions` resource.
 * @interface StripeSdkSubscriptions
 * @property {function} create Creates a subscription
 * @memberOf module:erpnext/payments
 */
export interface StripeSdkSubscriptions {
  create(params: Record<string, unknown>): Promise<Record<string, any>>;
}

/**
 * @description Minimal Stripe SDK client surface
 * @summary Subset of the official Stripe SDK used by {@link StripePaymentProvider}.
 * @interface StripeSdkClient
 * @property {StripeSdkPaymentIntents} paymentIntents Payment intents resource
 * @property {StripeSdkSetupIntents} [setupIntents] Setup intents resource
 * @property {StripeSdkPlans} [plans] Plans resource
 * @property {StripeSdkSubscriptions} [subscriptions] Subscriptions resource
 * @memberOf module:erpnext/payments
 */
export interface StripeSdkClient {
  paymentIntents: StripeSdkPaymentIntents;
  setupIntents?: StripeSdkSetupIntents;
  plans?: StripeSdkPlans;
  subscriptions?: StripeSdkSubscriptions;
}

/**
 * @description Stripe payment provider configuration
 * @summary Configuration accepted by {@link StripePaymentProvider}.
 * @interface StripePaymentProviderConfig
 * @property {"stripe"} provider Provider discriminator
 * @property {string} secretKey Stripe secret API key
 * @property {string} [publishableKey] Stripe publishable key
 * @property {string} [apiVersion] Stripe API version
 * @property {string} [productId] Stripe product id
 * @property {string} [customerId] Default Stripe customer id
 * @property {boolean} [preferSdk] Prefer the SDK over the REST transport
 * @property {StripeSdkClient} [sdk] Pre-instantiated Stripe SDK client
 * @property {function} [loadSdk] Lazy Stripe SDK loader
 * @memberOf module:erpnext/payments
 */
export interface StripePaymentProviderConfig
  extends ERPNextPaymentProviderConfig {
  provider: "stripe";
  secretKey: string;
  publishableKey?: string;
  apiVersion?: string;
  productId?: string;
  customerId?: string;
  preferSdk?: boolean;
  sdk?: StripeSdkClient;
  loadSdk?: () => Promise<StripeSdkClient>;
}

/**
 * @description SIBS payment provider configuration
 * @summary Configuration accepted by {@link SIBSPaymentProvider}.
 * @interface SIBSPaymentProviderConfig
 * @property {"sibs"} provider Provider discriminator
 * @property {string} merchantId SIBS merchant id
 * @property {string} [terminalId] SIBS terminal id
 * @property {string} [entityId] SIBS entity id
 * @property {string} [clientId] OAuth client id
 * @property {string} [clientSecret] OAuth client secret
 * @property {string} [accessToken] Pre-issued access token
 * @property {boolean} [mbwayEnabled] Enable MB WAY payments
 * @memberOf module:erpnext/payments
 */
export interface SIBSPaymentProviderConfig
  extends ERPNextPaymentProviderConfig {
  provider: "sibs";
  merchantId: string;
  terminalId?: string;
  entityId?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  mbwayEnabled?: boolean;
}

/**
 * @description GoCardless payment provider configuration
 * @summary Configuration accepted by {@link GoCardlessPaymentProvider}.
 * @interface GoCardlessPaymentProviderConfig
 * @property {"gocardless"} provider Provider discriminator
 * @property {string} accessToken GoCardless access token
 * @property {string} [version] GoCardless API version
 * @memberOf module:erpnext/payments
 */
export interface GoCardlessPaymentProviderConfig
  extends ERPNextPaymentProviderConfig {
  provider: "gocardless";
  accessToken: string;
  version?: string;
}

/**
 * @description Bizum payment provider configuration
 * @summary Configuration accepted by {@link BizumPaymentProvider}.
 * @interface BizumPaymentProviderConfig
 * @property {"bizum"} provider Provider discriminator
 * @property {string} merchantCode Bizum merchant code
 * @property {string} terminal Bizum terminal
 * @property {string} [apiKey] Bizum API key
 * @property {ERPNextPaymentSignatureProvider} [signatureProvider] Custom signature provider
 * @memberOf module:erpnext/payments
 */
export interface BizumPaymentProviderConfig
  extends ERPNextPaymentProviderConfig {
  provider: "bizum";
  merchantCode: string;
  terminal: string;
  apiKey?: string;
  signatureProvider?: ERPNextPaymentSignatureProvider;
}

/**
 * @description Union of supported payment provider configurations
 * @summary Discriminated by the `provider` field and accepted by the payment factory.
 * @typedef {object} ERPNextPaymentConfig
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentConfig =
  | StripePaymentProviderConfig
  | SIBSPaymentProviderConfig
  | GoCardlessPaymentProviderConfig
  | BizumPaymentProviderConfig;

/**
 * @description Minimal ERPNext client surface used by payment providers
 * @summary Structural subset of {@link ERPNextClient} the providers depend on.
 * @interface ERPNextPaymentTarget
 * @property {function} [listDocs] Lists doctype documents
 * @property {function} [getDoc] Reads a single document
 * @property {function} [createDoc] Creates a document
 * @property {function} [updateDoc] Updates a document
 * @property {ERPNextPaymentTarget} [client] Underlying client
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentTarget {
  listDocs?(
    doctype: string,
    options?: Record<string, unknown>
  ): Promise<Record<string, any>[]>;
  getDoc?(doctype: string, name: string): Promise<Record<string, any>>;
  createDoc?(
    doctype: string,
    data: Record<string, any>
  ): Promise<Record<string, any>>;
  updateDoc?(
    doctype: string,
    name: string,
    data: Record<string, any>
  ): Promise<Record<string, any>>;
  client?: ERPNextPaymentTarget;
}

/**
 * @description Payment gateway registration options
 * @summary Options controlling gateway registration in ERPNext.
 * @interface ERPNextPaymentGatewayOptions
 * @property {string} [gatewayName] Override the generated gateway name
 * @property {boolean} [includeSecrets] Include secret settings in the result
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentGatewayOptions {
  gatewayName?: string;
  includeSecrets?: boolean;
}

/**
 * @description Payment gateway registration result
 * @summary Outcome of registering a provider gateway in ERPNext.
 * @interface ERPNextPaymentGatewayRegistration
 * @property {ERPNextPaymentProviderKey} provider The provider key
 * @property {string} gateway The ERPNext gateway name
 * @property {boolean} created Whether the gateway was created
 * @property {Record<string, unknown>} settings The gateway settings
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentGatewayRegistration {
  provider: ERPNextPaymentProviderKey;
  gateway: string;
  created: boolean;
  settings: Record<string, unknown>;
}

/**
 * @description Payment intent creation input
 * @summary Common input accepted when creating a payment intent.
 * @interface ERPNextPaymentIntentInput
 * @property {number|string} amount Amount to charge
 * @property {string} [currency] Currency
 * @property {string} [reference] Merchant reference
 * @property {string} [customer] Customer identifier
 * @property {string} [description] Payment description
 * @property {Record<string, unknown>} [metadata] Arbitrary metadata
 * @property {string} [paymentMethod] Payment method
 * @property {string} [phoneNumber] Phone number for mobile payments
 * @property {string} [mandateId] Provider mandate id
 * @property {string} [paymentMethodToken] Tokenized payment method
 * @property {string} [order] Order reference
 * @property {string} [redirectUrl] Return URL after approval
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentIntentInput {
  amount: number | string;
  currency?: string;
  reference?: string;
  customer?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  paymentMethod?: string;
  phoneNumber?: string;
  mandateId?: string;
  paymentMethodToken?: string;
  order?: string;
  redirectUrl?: string;
}

/**
 * @description Payment intent result
 * @summary Normalized result returned by every provider.
 * @interface ERPNextPaymentIntentResult
 * @property {ERPNextPaymentProviderKey} provider The provider key
 * @property {string} id Provider payment id
 * @property {string} status Provider status
 * @property {string} [clientSecret] Client secret for confirmation
 * @property {string} [approvalUrl] URL the payer must visit
 * @property {Record<string, any>} raw Raw provider response
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentIntentResult {
  provider: ERPNextPaymentProviderKey;
  id: string;
  status: string;
  clientSecret?: string;
  approvalUrl?: string;
  raw: Record<string, any>;
}

/**
 * @description Payment request creation input
 * @summary Extends the payment intent input with ERPNext Payment Request fields.
 * @interface ERPNextPaymentRequestInput
 * @property {"Inward"|"Outward"} [paymentRequestType] Request direction
 * @property {string} [partyType] ERPNext party type
 * @property {string} [party] ERPNext party
 * @property {string} [referenceDoctype] Referenced doctype
 * @property {string} [referenceName] Referenced document
 * @property {string} [emailTo] Recipient email
 * @property {string} [subject] Email subject
 * @property {string} [message] Email message
 * @property {Date|string} [transactionDate] Transaction date
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentRequestInput extends ERPNextPaymentIntentInput {
  paymentRequestType?: "Inward" | "Outward";
  partyType?: string;
  party?: string;
  referenceDoctype?: string;
  referenceName?: string;
  emailTo?: string;
  subject?: string;
  message?: string;
  transactionDate?: Date | string;
}

/**
 * @description Payment request creation result
 * @summary Combines the ERPNext Payment Request with the optional provider intent.
 * @interface ERPNextPaymentRequestResult
 * @property {Record<string, any>} paymentRequest The ERPNext Payment Request
 * @property {ERPNextPaymentIntentResult} [payment] The provider payment intent
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentRequestResult {
  paymentRequest: Record<string, any>;
  payment?: ERPNextPaymentIntentResult;
}

/**
 * @description Payment plan input
 * @summary Input accepted when creating or resolving a recurring plan.
 * @interface ERPNextPaymentPlanInput
 * @property {string} planName Plan name
 * @property {number|string} amount Plan amount
 * @property {string} [currency] Currency
 * @property {ERPNextPaymentInterval} [interval] Billing interval
 * @property {number} [intervalCount] Number of interval units per cycle
 * @property {string} [providerPlanId] Existing provider plan id
 * @property {string} [description] Plan description
 * @property {string} [productId] Provider product id
 * @property {string} [erpnextPlanName] ERPNext Subscription Plan name
 * @property {string} [item] ERPNext item
 * @property {string} [priceDetermination] ERPNext price determination mode
 * @property {number} [qty] Quantity
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentPlanInput {
  planName: string;
  amount: number | string;
  currency?: string;
  interval?: ERPNextPaymentInterval;
  intervalCount?: number;
  providerPlanId?: string;
  description?: string;
  productId?: string;
  erpnextPlanName?: string;
  item?: string;
  priceDetermination?: string;
  qty?: number;
}

/**
 * @description Payment plan result
 * @summary Normalized plan information returned by a provider.
 * @interface ERPNextPaymentPlanResult
 * @property {ERPNextPaymentProviderKey} provider The provider key
 * @property {string} providerPlanId Provider plan id
 * @property {Record<string, any>} plan The ERPNext Subscription Plan
 * @property {boolean} created Whether the plan was created
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentPlanResult {
  provider: ERPNextPaymentProviderKey;
  providerPlanId: string;
  plan: Record<string, any>;
  created: boolean;
}

/**
 * @description Payment subscription input
 * @summary Input accepted when creating a recurring subscription.
 * @interface ERPNextPaymentSubscriptionInput
 * @property {string} [partyType] ERPNext party type
 * @property {string} [party] ERPNext party
 * @property {string} [planName] Plan name
 * @property {string} [subscriptionPlan] ERPNext Subscription Plan name
 * @property {string} [providerPlanId] Provider plan id
 * @property {number|string} [amount] Amount
 * @property {string} [currency] Currency
 * @property {ERPNextPaymentInterval} [interval] Billing interval
 * @property {number} [intervalCount] Number of interval units per cycle
 * @property {Date|string} [startDate] First billing date
 * @property {string} [customer] Customer identifier
 * @property {string} [mandateId] Provider mandate id
 * @property {string} [paymentMethodToken] Tokenized payment method
 * @property {string} [reference] Merchant reference
 * @property {Record<string, unknown>} [metadata] Arbitrary metadata
 * @property {boolean} [cancelAtPeriodEnd] Cancel at the end of the period
 * @property {string} [company] ERPNext company
 * @property {string} [generateInvoiceAt] When to generate invoices
 * @property {number} [qty] Quantity
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentSubscriptionInput {
  partyType?: string;
  party?: string;
  planName?: string;
  subscriptionPlan?: string;
  providerPlanId?: string;
  amount?: number | string;
  currency?: string;
  interval?: ERPNextPaymentInterval;
  intervalCount?: number;
  startDate?: Date | string;
  customer?: string;
  mandateId?: string;
  paymentMethodToken?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  cancelAtPeriodEnd?: boolean;
  company?: string;
  generateInvoiceAt?: string;
  qty?: number;
}

/**
 * @description Payment subscription result
 * @summary Normalized subscription information returned by a provider.
 * @interface ERPNextPaymentSubscriptionResult
 * @property {ERPNextPaymentProviderKey} provider The provider key
 * @property {string} providerSubscriptionId Provider subscription id
 * @property {Record<string, any>} subscription The ERPNext Subscription
 * @property {ERPNextPaymentPlanResult} [plan] The related plan
 * @property {Record<string, any>} raw Raw provider response
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentSubscriptionResult {
  provider: ERPNextPaymentProviderKey;
  providerSubscriptionId: string;
  subscription: Record<string, any>;
  plan?: ERPNextPaymentPlanResult;
  raw: Record<string, any>;
}

/**
 * @description Normalized webhook payment status
 * @summary Status values every provider webhook is mapped onto.
 * @typedef {object} ERPNextPaymentWebhookStatus
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentWebhookStatus =
  | "succeeded"
  | "failed"
  | "pending"
  | "active"
  | "cancelled"
  | "unknown";

/**
 * @description Webhook-driven ERPNext action
 * @summary Action the webhook handler should apply to ERPNext documents.
 * @typedef {object} ERPNextPaymentWebhookAction
 * @memberOf module:erpnext/payments
 */
export type ERPNextPaymentWebhookAction =
  | "mark-paid"
  | "mark-failed"
  | "activate-subscription"
  | "cancel-subscription"
  | "ignore";

/**
 * @description Normalized payment webhook event
 * @summary Provider-agnostic webhook payload produced by {@link ERPNextPaymentProvider.parseWebhook}.
 * @interface ERPNextPaymentWebhookEvent
 * @property {ERPNextPaymentProviderKey} provider The provider key
 * @property {string} [id] Provider event id
 * @property {string} type Provider event type
 * @property {ERPNextPaymentWebhookStatus} status Normalized status
 * @property {string} [paymentId] Provider payment id
 * @property {string} [subscriptionId] Provider subscription id
 * @property {number} [amount] Payment amount
 * @property {string} [currency] Currency
 * @property {ERPNextPaymentWebhookAction[]} actions Actions to apply
 * @property {unknown} raw Raw provider payload
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentWebhookEvent {
  provider: ERPNextPaymentProviderKey;
  id?: string;
  type: string;
  status: ERPNextPaymentWebhookStatus;
  paymentId?: string;
  subscriptionId?: string;
  amount?: number;
  currency?: string;
  actions: ERPNextPaymentWebhookAction[];
  raw: unknown;
}

/**
 * @description Payment webhook handling options
 * @summary Extra options accepted when parsing a webhook.
 * @interface ERPNextPaymentWebhookOptions
 * @property {string} [signature] Signature header value
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentWebhookOptions {
  signature?: string;
}
