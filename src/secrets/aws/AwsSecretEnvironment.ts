/**
 * @module integrations/secrets/aws/environment
 * @summary AWS Secrets Manager environment.
 * @description Extends the common secrets environment with the `secrets.aws` shape
 * matching {@link AwsSecretServiceConfig}, so {@link AwsSecretService} can fall back
 * to it when no config is passed to `initialize`.
 */
import { SecretEnvironment } from "../core/SecretEnvironment";

export interface AwsSecretEnvironmentCredentials {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface AwsSecretEnvironmentConfig {
  region: string;
  endpoint?: string;
  keyId?: string;
  credentials?: AwsSecretEnvironmentCredentials;
}

export interface AwsSecretEnvironmentShape {
  secrets: {
    aws: AwsSecretEnvironmentConfig;
  };
}

export const AwsSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    aws: {
      region: "",
      endpoint: "",
      keyId: "",
      credentials: {
        accessKeyId: "",
        secretAccessKey: "",
        sessionToken: "",
      },
    },
  },
} as AwsSecretEnvironmentShape);
