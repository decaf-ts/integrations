/**
 * @module integrations/blob/azure/node-service
 * @summary Non-Environment node variant of the Azure Blob Storage.
 * @description Exposes `{@link AzureNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `AzureBlobStoreService` implementation resolved
 * via `serviceImplementation("blob-azure", AzureBlobStoreService)` rather than the
 * `@service("blob-azure")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { AzureBlobStoreService } from "./AzureBlobStoreService";

const AzureBase = serviceImplementation("blob-azure", AzureBlobStoreService);

/**
 * @description Non-Environment node variant of the Azure Blob Storage
 * @summary Standalone subclass of the undecorated `AzureBlobStoreService` implementation,
 * resolved through `serviceImplementation("blob-azure", AzureBlobStoreService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("blob-azure")`-decorated
 * `{@link AzureBlobStoreService}`: the original remains registered and
 * Environment-configurable (the `blobs.azure` slice) for infrastructure boot,
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
 * The blob provider is fixed by the subclass to `"azure-blob"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `AzureBlobStoreService` API.
 * @class AzureNodeService
 * @category Blob
 * @example
 * ```ts
 * import { AzureNodeService } from "@decaf-ts/integrations/blob/azure";
 *
 * const azure = await new AzureNodeService().boot({
 *   container: "my-container",
 *   connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
 * });
 * ```
 * @memberOf module:integrations/blob/azure/node-service
 */
export class AzureNodeService extends nonEnvironmentService(
  AzureBase,
  "azure-blob"
) {}
