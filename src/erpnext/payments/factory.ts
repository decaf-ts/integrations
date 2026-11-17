import { ValidationError } from "@decaf-ts/db-decorators";
import { BizumPaymentProvider } from "./BizumPaymentProvider";
import { ERPNextPaymentProviderKeys } from "./constants";
import { ERPNextPaymentsEnvironment } from "./environment";
import { ERPNextPaymentConfigurationError } from "./errors";
import { GoCardlessPaymentProvider } from "./GoCardlessPaymentProvider";
import { SIBSPaymentProvider } from "./SIBSPaymentProvider";
import { StripePaymentProvider } from "./StripePaymentProvider";
import type {
  ERPNextPaymentConfig,
  ERPNextPaymentProviderKey,
} from "./types";

/**
 * @description Union of the supported payment provider implementations
 * @typedef {object} AnyERPNextPaymentProvider
 * @memberOf module:erpnext/payments
 */
export type AnyERPNextPaymentProvider =
  | StripePaymentProvider
  | SIBSPaymentProvider
  | GoCardlessPaymentProvider
  | BizumPaymentProvider;

/**
 * @description Checks whether a value is a supported payment provider key
 * @param {unknown} value - The value to check
 * @return {boolean} `true` when the value is a known provider key
 */
export function isERPNextPaymentProviderKey(
  value: unknown
): value is ERPNextPaymentProviderKey {
  return ERPNextPaymentProviderKeys.includes(
    value as ERPNextPaymentProviderKey
  );
}

/**
 * @description Resolves the payment provider key to use
 * @summary Falls back to the accumulated environment provider when no explicit
 * value is supplied and throws {@link ValidationError} for unknown keys.
 * @param {string} [value] - Explicit provider key
 * @return {ERPNextPaymentProviderKey} The resolved provider key
 */
export function resolveERPNextPaymentProviderKey(
  value?: string | null
): ERPNextPaymentProviderKey {
  const candidate =
    value || ERPNextPaymentsEnvironment.erpnext.payments.provider;
  if (!isERPNextPaymentProviderKey(candidate))
    throw new ValidationError(
      `Unknown ERPNext payment provider "${String(candidate)}". Use one of ${ERPNextPaymentProviderKeys.join(", ")}`
    );
  return candidate;
}

/**
 * @description Instantiates the payment provider selected by the configuration
 * @summary Returns the concrete provider class for the configured key and throws
 * {@link ERPNextPaymentConfigurationError} for unsupported keys.
 * @param {ERPNextPaymentConfig} config - The payment configuration
 * @return {AnyERPNextPaymentProvider} The provider instance
 */
export function createERPNextPaymentProvider(
  config: ERPNextPaymentConfig
): AnyERPNextPaymentProvider {
  switch (config.provider) {
    case "stripe":
      return new StripePaymentProvider();
    case "sibs":
      return new SIBSPaymentProvider();
    case "gocardless":
      return new GoCardlessPaymentProvider();
    case "bizum":
      return new BizumPaymentProvider();
    default:
      throw new ERPNextPaymentConfigurationError(
        `Unsupported ERPNext payment provider "${String(
          (config as { provider?: unknown }).provider
        )}"`
      );
  }
}

/**
 * @description Creates and initializes a payment provider integration
 * @summary Builds the provider selected by the configuration and awaits its
 * {@link ERPNextPaymentProvider.initialize} lifecycle before returning it.
 * @param {ERPNextPaymentConfig} config - The payment configuration
 * @return {Promise<AnyERPNextPaymentProvider>} The initialized provider
 */
export async function createERPNextPaymentIntegration(
  config: ERPNextPaymentConfig
): Promise<AnyERPNextPaymentProvider> {
  const provider = createERPNextPaymentProvider(config);
  await provider.initialize(config as never);
  return provider;
}
