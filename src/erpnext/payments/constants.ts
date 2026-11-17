/**
 * @description Supported ERPNext payment provider keys
 * @summary Identifiers accepted by {@link createERPNextPaymentProvider} and the
 * payments environment configuration.
 * @const ERPNextPaymentProviderKeys
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentProviderKeys = [
  "stripe",
  "sibs",
  "gocardless",
  "bizum",
] as const;

/**
 * @description Frappe doctypes used by the payment integrations
 * @summary Canonical doctype names for gateways, payment requests, subscriptions
 * and subscription plans.
 * @const ERPNextPaymentDoctypes
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentDoctypes = {
  gateway: "Payment Gateway",
  paymentRequest: "Payment Request",
  subscription: "Subscription",
  subscriptionPlan: "Subscription Plan",
} as const;

/**
 * @description Default payment provider request timeout in milliseconds
 * @const ERPNextPaymentDefaultTimeout
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentDefaultTimeout = 30000;

/**
 * @description Default currency used for payment intents and subscriptions
 * @const ERPNextPaymentDefaultCurrency
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentDefaultCurrency = "EUR";

/**
 * @description Default subscription billing interval
 * @const ERPNextPaymentDefaultInterval
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentDefaultInterval = "Month";

/**
 * @description Allowed payment subscription billing intervals
 * @summary Normalized interval units shared by every payment provider.
 * @const ERPNextPaymentIntervals
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentIntervals = ["Day", "Week", "Month", "Year"] as const;

/**
 * @description Currencies that do not use minor units
 * @summary Used to decide whether an amount must be multiplied by 100 before it is
 * sent to a payment provider.
 * @const ERPNextPaymentZeroDecimalCurrencies
 * @memberOf module:erpnext/payments
 */
export const ERPNextPaymentZeroDecimalCurrencies = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
