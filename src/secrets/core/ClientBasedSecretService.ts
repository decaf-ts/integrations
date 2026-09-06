/**
 * @module integrations/secrets/core/service
 * @summary Client-based secret service abstraction.
 * @description Base abstraction shared by every secret provider service. Adds a
 * config-or-environment resolution step on top of {@link ClientBasedService}, mirroring
 * the blob store abstraction: providers extend the common secrets environment with
 * their own predefined `secrets.<provider>` shape so `initialize` can fall back to it
 * when no config is passed as the first initialize argument.
 */
import { ClientBasedService, type MaybeContextualArg } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import type { SecretServiceConfig } from "./SecretTypes";

export abstract class ClientBasedSecretService<
  TClient = unknown,
  TConfig extends SecretServiceConfig = SecretServiceConfig,
> extends ClientBasedService<TClient, TConfig> {
  protected getConfigFromArgs<TExpected extends TConfig>(
    ...args: MaybeContextualArg<any>
  ): TExpected {
    const config = args[0] as TExpected | undefined;
    if (config && typeof config === "object") {
      return config;
    }
    const fromEnvironment = this.configFromEnvironment() as
      | TExpected
      | undefined;
    if (fromEnvironment) return fromEnvironment;
    throw new ValidationError(
      "Secret service config must be the first initialize argument, or resolvable from environment"
    );
  }

  /**
   * @description Builds a config from the provider's environment as a fallback.
   * @summary Providers must override this to read from their own `secrets.<provider>`
   * environment slice.
   */
  protected abstract configFromEnvironment(): TConfig | undefined;
}
