/**
 * @module integrations/blob/gcp/node-service
 * @summary Non-Environment node variant of the GCS blob store.
 * @description Exposes `{@link GcsNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GcsBlobStoreService` implementation resolved
 * via `serviceImplementation("blob-gcs", GcsBlobStoreService)` rather than the
 * `@service("blob-gcs")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GcsBlobStoreService } from "./GcsBlobStoreService";

const GcsBase = serviceImplementation("blob-gcs", GcsBlobStoreService);

/**
 * @description Non-Environment node variant of the GCS blob store
 * @summary Standalone subclass of the undecorated `GcsBlobStoreService` implementation,
 * resolved through `serviceImplementation("blob-gcs", GcsBlobStoreService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("blob-gcs")`-decorated
 * `{@link GcsBlobStoreService}`: the original remains registered and
 * Environment-configurable (the `blobs.gcs` slice) for infrastructure boot,
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
 * The blob provider is fixed by the subclass to `"gcs"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `GcsBlobStoreService` API.
 * @class GcsNodeService
 * @category Blob
 * @example
 * ```ts
 * import { GcsNodeService } from "@decaf-ts/integrations/blob/gcp";
 *
 * const gcs = await new GcsNodeService().boot({
 *   bucket: "my-bucket",
 *   projectId: "my-project",
 * });
 * ```
 * @memberOf module:integrations/blob/gcp/node-service
 */
export class GcsNodeService extends nonEnvironmentService(GcsBase, "gcs") {}
