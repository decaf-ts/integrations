import { LoggedEnvironment } from "@decaf-ts/logging";
import type { ERPNextPaymentProviderKey } from "./types";

/**
 * @description Stripe environment configuration for the ERPNext payments module
 * @summary Keys and endpoints resolved from the `erpnext.payments.stripe`
 * environment namespace.
 * @interface ERPNextStripeEnvironmentConfig
 * @memberOf module:erpnext/payments
 */
export interface ERPNextStripeEnvironmentConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  productId: string;
  apiVersion: string;
  baseUrl: string;
}

/**
 * @description SIBS environment configuration for the ERPNext payments module
 * @summary Merchant, terminal and OAuth credentials resolved from
 * `erpnext.payments.sibs`.
 * @interface ERPNextSibEnvironmentConfig
 * @memberOf module:erpnext/payments
 */
export interface ERPNextSibEnvironmentConfig {
  merchantId: string;
  terminalId: string;
  entityId: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  mbwayEnabled: boolean;
  baseUrl: string;
}

/**
 * @description GoCardless environment configuration for the ERPNext payments module
 * @summary Access token, webhook secret and API version resolved from
 * `erpnext.payments.gocardless`.
 * @interface ERPNextGoCardlessEnvironmentConfig
 * @memberOf module:erpnext/payments
 */
export interface ERPNextGoCardlessEnvironmentConfig {
  accessToken: string;
  webhookSecret: string;
  version: string;
  baseUrl: string;
}

/**
 * @description Bizum environment configuration for the ERPNext payments module
 * @summary Merchant code, terminal, API key and webhook secret resolved from
 * `erpnext.payments.bizum`.
 * @interface ERPNextBizumEnvironmentConfig
 * @memberOf module:erpnext/payments
 */
export interface ERPNextBizumEnvironmentConfig {
  merchantCode: string;
  terminal: string;
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
}

/**
 * @description Complete ERPNext payments environment shape
 * @summary Groups the active provider selection, currency, sandbox flag and every
 * provider-specific configuration block.
 * @interface ERPNextPaymentsEnvironmentShape
 * @memberOf module:erpnext/payments
 */
export interface ERPNextPaymentsEnvironmentShape {
  erpnext: {
    payments: {
      provider: ERPNextPaymentProviderKey | "";
      currency: string;
      sandbox: boolean;
      gatewayNamePrefix: string;
      timeout: number;
      stripe: ERPNextStripeEnvironmentConfig;
      sibs: ERPNextSibEnvironmentConfig;
      gocardless: ERPNextGoCardlessEnvironmentConfig;
      bizum: ERPNextBizumEnvironmentConfig;
    };
  };
}

/**
 * @description Accumulated ERPNext payments environment
 * @summary Loads the `erpnext.payments` namespace through
 * {@link LoggedEnvironment.accumulate} with safe defaults, so providers can be
 * resolved from environment variables or explicit configuration.
 * @const ERPNextPaymentsEnvironment
 * @memberOf module:erpnext/payments
 * @example
 * ```typescript
 * const provider = ERPNextPaymentsEnvironment.erpnext.payments.provider;
 * ```
 */
export const ERPNextPaymentsEnvironment =
  LoggedEnvironment.accumulate({
    erpnext: {
      payments: {
        provider: "" as ERPNextPaymentProviderKey | "",
        currency: "EUR",
        sandbox: true,
        gatewayNamePrefix: "",
        timeout: 30000,
        stripe: {
          secretKey: "",
          publishableKey: "",
          webhookSecret: "",
          productId: "",
          apiVersion: "",
          baseUrl: "",
        },
        sibs: {
          merchantId: "",
          terminalId: "",
          entityId: "",
          clientId: "",
          clientSecret: "",
          accessToken: "",
          mbwayEnabled: false,
          baseUrl: "",
        },
        gocardless: {
          accessToken: "",
          webhookSecret: "",
          version: "2015-07-06",
          baseUrl: "",
        },
        bizum: {
          merchantCode: "",
          terminal: "",
          apiKey: "",
          webhookSecret: "",
          baseUrl: "",
        },
      },
    },
  } as ERPNextPaymentsEnvironmentShape);
