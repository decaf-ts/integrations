/**
 * @module integrations/blob/s3/node-service
 * @summary Non-Environment node variant of the S3 blob store.
 * @description Exposes `{@link S3NodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `S3BlobStoreService` implementation resolved
 * via `serviceImplementation("blob-s3", S3BlobStoreService)` rather than the
 * `@service("blob-s3")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { S3BlobStoreService } from "./S3BlobStoreService";

const S3Base = serviceImplementation("blob-s3", S3BlobStoreService);

/**
 * @description Non-Environment node variant of the S3 blob store
 * @summary Standalone subclass of the undecorated `S3BlobStoreService` implementation,
 * resolved through `serviceImplementation("blob-s3", S3BlobStoreService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("blob-s3")`-decorated
 * `{@link S3BlobStoreService}`: the original remains registered and
 * Environment-configurable (the `blobs.s3` slice) for infrastructure boot,
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
 * The blob provider is fixed by the subclass to `"s3"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `S3BlobStoreService` API.
 * @class S3NodeService
 * @category Blob
 * @example
 * ```ts
 * import { S3NodeService } from "@decaf-ts/integrations/blob/s3";
 *
 * const s3 = await new S3NodeService().boot({
 *   bucket: "my-bucket",
 *   region: "eu-west-1",
 * });
 * ```
 * @memberOf module:integrations/blob/s3/node-service
 */
export class S3NodeService extends nonEnvironmentService(S3Base, "s3") {}
