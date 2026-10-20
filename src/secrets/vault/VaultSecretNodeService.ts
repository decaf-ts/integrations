/**
 * @module integrations/secrets/vault/node-service
 * @summary Non-Environment node variant of the HashiCorp Vault.
 * @description Exposes `{@link VaultSecretNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `VaultSecretService` implementation resolved
 * via `serviceImplementation("secret-vault", VaultSecretService)` rather than the
 * `@service("secret-vault")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { VaultSecretService } from "./VaultSecretService";

const VaultSecretBase = serviceImplementation(
  "secret-vault",
  VaultSecretService
);

/**
 * @description Non-Environment node variant of the HashiCorp Vault
 * @summary Standalone subclass of the undecorated `VaultSecretService` implementation,
 * resolved through `serviceImplementation("secret-vault", VaultSecretService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-vault")`-decorated
 * `{@link VaultSecretService}`: the original remains registered and
 * Environment-configurable (the `secrets.vault` slice) for infrastructure boot,
 * while this subclass:
 *
 * - is **not** `@service()`-decorated: it is not registered in
 *   `Injectables`, not a singleton, and never auto-booted by static
 *   `Service.boot()`;
 * - reads no Environment configuration, so it must be initialized
 *   explicitly with `await instance.boot(config)`;
 * - rejects a no-argument or `Context`-only boot with a `ValidationError`
 *   (from `explicitNodeConfig`) because no Environment fallback exists.
 *
 * The secret provider is fixed by the subclass to `"hashicorp-vault"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `VaultSecretService` API.
 * @class VaultSecretNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { VaultSecretNodeService } from "@decaf-ts/integrations/secrets/vault";
 *
 * const vault = await new VaultSecretNodeService().boot({
 *   address: "https://vault.example.com:8200",
 *   token: process.env.VAULT_TOKEN,
 *   path: "secret",
 * });
 * ```
 * @memberOf module:integrations/secrets/vault/node-service
 */
export class VaultSecretNodeService extends nonEnvironmentService(
  VaultSecretBase,
  "hashicorp-vault"
) {}
