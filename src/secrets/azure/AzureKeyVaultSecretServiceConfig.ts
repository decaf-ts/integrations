/**
 * @module integrations/secrets/azure/config
 * @summary Azure Key Vault secret service configuration.
 * @description Configuration schema for the Azure Key Vault integration.
 */
import { SecretServiceConfig } from "../../secrets/core";

export interface AzureKeyVaultSecretServiceConfig extends SecretServiceConfig {
  provider: "azure-key-vault";
  vaultUrl: string;
  credentials?: any;
}
