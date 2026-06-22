import { SecretServiceConfig } from "../../secrets/core";

export interface OnePasswordSecretServiceConfig extends SecretServiceConfig {
  provider: "1password";
  connectHost: string;
  connectToken?: string;
  vaultId?: string;
  itemIdTemplate?: string;
}
