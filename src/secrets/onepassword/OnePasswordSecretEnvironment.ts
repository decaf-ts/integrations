/**
 * @module integrations/secrets/onepassword/environment
 * @summary 1Password Connect secret environment.
 * @description Extends the common secrets environment with the `secrets.onePassword`
 * shape matching {@link OnePasswordSecretServiceConfig}, so {@link OnePasswordSecretService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { SecretEnvironment } from "../core/SecretEnvironment";

export interface OnePasswordSecretEnvironmentConfig {
  connectHost: string;
  connectToken?: string;
  vaultId?: string;
  itemIdTemplate?: string;
  keyId?: string;
}

export interface OnePasswordSecretEnvironmentShape {
  secrets: {
    onePassword: OnePasswordSecretEnvironmentConfig;
  };
}

export const OnePasswordSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    onePassword: {
      connectHost: "",
      connectToken: "",
      vaultId: "",
      itemIdTemplate: "",
      keyId: "",
    },
  },
} as OnePasswordSecretEnvironmentShape);
