/**
 * @module integrations/secrets/model/environment
 * @summary Model-backed secret environment.
 * @description Extends the common secrets environment with the `secrets.model` shape
 * matching {@link ModelSecretServiceConfig}, so {@link ModelSecretService} can fall
 * back to it when no config is passed to `initialize`.
 */
import { SecretEnvironment } from "../core/SecretEnvironment";

export interface ModelSecretEnvironmentConfig {
  keySecret: string;
  keyId?: string;
}

export interface ModelSecretEnvironmentShape {
  secrets: {
    model: ModelSecretEnvironmentConfig;
  };
}

export const ModelSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    model: {
      keySecret: "",
      keyId: "",
    },
  },
} as ModelSecretEnvironmentShape);
