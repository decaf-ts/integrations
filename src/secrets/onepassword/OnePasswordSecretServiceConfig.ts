/**
 * @module integrations/secrets/onepassword/config
 * @summary 1Password secret service configuration.
 * @description Configuration schema for the 1Password Connect integration.
 */
import { SecretServiceConfig } from "../../secrets/core";

export interface OnePasswordSecretServiceConfig extends SecretServiceConfig {
  provider: "1password";
  connectHost: string;
  connectToken?: string;
  vaultId?: string;
  itemIdTemplate?: string;
}
