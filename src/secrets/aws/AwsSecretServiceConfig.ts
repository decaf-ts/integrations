/**
 * @module integrations/secrets/aws/config
 * @summary AWS secret service configuration.
 * @description Configuration schema for the AWS Secrets Manager integration.
 */
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
