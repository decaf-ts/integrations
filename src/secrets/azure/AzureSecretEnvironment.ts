/**
 * @module integrations/secrets/azure/environment
 * @summary Azure Key Vault secret environment.
 * @description Extends the common secrets environment with the `secrets.azure` shape
 * matching {@link AzureKeyVaultSecretServiceConfig}, so {@link AzureKeyVaultSecretService}
 * can fall back to it when no config is passed to `initialize`. The `credentials` field
 * is intentionally left out: it is an opaque credential object, not a flat set of
 * env-friendly values, so it is expected to come through the constructor config.
 */
import { SecretEnvironment } from "../core/SecretEnvironment";

export interface AzureSecretEnvironmentConfig {
  vaultUrl: string;
  keyId?: string;
}

export interface AzureSecretEnvironmentShape {
  secrets: {
    azure: AzureSecretEnvironmentConfig;
  };
}

export const AzureSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    azure: {
      vaultUrl: "",
      keyId: "",
    },
  },
} as AzureSecretEnvironmentShape);
