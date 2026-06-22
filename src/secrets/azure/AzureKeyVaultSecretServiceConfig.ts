import { SecretServiceConfig } from "../../secrets/core";

export interface AzureKeyVaultSecretServiceConfig extends SecretServiceConfig {
  provider: "azure-key-vault";
  vaultUrl: string;
  credentials?: any;
}
