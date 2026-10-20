/**
 * @module integrations/secrets/azure/node-service
 * @summary Non-Environment node variant of the Azure Key Vault.
 * @description Exposes `{@link AzureKeyVaultSecretNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `AzureKeyVaultSecretService` implementation resolved
 * via `serviceImplementation("secret-azure", AzureKeyVaultSecretService)` rather than the
 * `@service("secret-azure")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { AzureKeyVaultSecretService } from "./AzureKeyVaultSecretService";

const AzureKeyVaultBase = serviceImplementation(
  "secret-azure",
  AzureKeyVaultSecretService
);

/**
 * @description Non-Environment node variant of the Azure Key Vault
 * @summary Standalone subclass of the undecorated `AzureKeyVaultSecretService` implementation,
 * resolved through `serviceImplementation("secret-azure", AzureKeyVaultSecretService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-azure")`-decorated
 * `{@link AzureKeyVaultSecretService}`: the original remains registered and
 * Environment-configurable (the `secrets.azure` slice) for infrastructure boot,
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
 * The secret provider is fixed by the subclass to `"azure-key-vault"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `AzureKeyVaultSecretService` API.
 * @class AzureKeyVaultSecretNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { AzureKeyVaultSecretNodeService } from "@decaf-ts/integrations/secrets/azure";
 *
 * const keyVault = await new AzureKeyVaultSecretNodeService().boot({
 *   vaultUrl: "https://my-vault.vault.azure.net",
 * });
 * ```
 * @memberOf module:integrations/secrets/azure/node-service
 */
export class AzureKeyVaultSecretNodeService extends nonEnvironmentService(
  AzureKeyVaultBase,
  "azure-key-vault"
) {}
