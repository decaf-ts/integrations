/**
 * @module integrations/secrets/vault/environment
 * @summary HashiCorp Vault secret environment.
 * @description Extends the common secrets environment with the `secrets.vault` shape
 * matching {@link VaultSecretServiceConfig}, so {@link VaultSecretService} can fall
 * back to it when no config is passed to `initialize`.
 */
import { SecretEnvironment } from "../core/SecretEnvironment";

export interface VaultSecretEnvironmentConfig {
  address: string;
  token: string;
  path: string;
  namespace?: string;
  keyId?: string;
}

export interface VaultSecretEnvironmentShape {
  secrets: {
    vault: VaultSecretEnvironmentConfig;
  };
}

export const VaultSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    vault: {
      address: "",
      token: "",
      path: "",
      namespace: "",
      keyId: "",
    },
  },
} as VaultSecretEnvironmentShape);
