/**
 * @module integrations/secrets/core/environment
 * @summary Common secrets environment.
 * @description Base environment shared by every secret provider. Provider-specific
 * services extend this environment with their own predefined `secrets.<provider>`
 * shape so {@link ClientBasedSecretService.initialize} can fall back to environment-sourced
 * config when no config is passed as the first initialize argument.
 */
import { LoggedEnvironment } from "@decaf-ts/logging";
import type { SecretProvider } from "./SecretTypes";

export interface SecretCommonEnvironmentShape {
  secrets: {
    provider: SecretProvider;
  };
}

export const SecretEnvironment = LoggedEnvironment.accumulate({
  secrets: {
    provider: "" as SecretProvider,
  },
} as SecretCommonEnvironmentShape);
