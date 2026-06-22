import { SecretServiceConfig } from "../../secrets/core";

export interface VaultSecretServiceConfig extends SecretServiceConfig {
  provider: "hashicorp-vault";
  address: string;
  token: string;
  path: string;
  namespace?: string;
}
