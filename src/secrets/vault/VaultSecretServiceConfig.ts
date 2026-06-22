/**
 * @module integrations/secrets/vault/config
 * @summary Vault secret service configuration.
 * @description Configuration schema for the HashiCorp Vault KV v2 integration.
 */
import { SecretServiceConfig } from "../../secrets/core";

export interface VaultSecretServiceConfig extends SecretServiceConfig {
  provider: "hashicorp-vault";
  address: string;
  token: string;
  path: string;
  namespace?: string;
}
