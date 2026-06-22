import { SecretServiceConfig } from "../../secrets/core";

export interface AwsSecretServiceConfig extends SecretServiceConfig {
  provider: "aws-secrets-manager";
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  endpoint?: string;
}
