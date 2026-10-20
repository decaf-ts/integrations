/**
 * @module integrations/secrets/gcp/node-service
 * @summary Non-Environment node variant of the Google Cloud Secret Manager.
 * @description Exposes `{@link GcpSecretManagerNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GcpSecretManagerService` implementation resolved
 * via `serviceImplementation("secret-gcp", GcpSecretManagerService)` rather than the
 * `@service("secret-gcp")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GcpSecretManagerService } from "./GcpSecretManagerService";

const GcpSecretManagerBase = serviceImplementation(
  "secret-gcp",
  GcpSecretManagerService
);

/**
 * @description Non-Environment node variant of the Google Cloud Secret Manager
 * @summary Standalone subclass of the undecorated `GcpSecretManagerService` implementation,
 * resolved through `serviceImplementation("secret-gcp", GcpSecretManagerService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-gcp")`-decorated
 * `{@link GcpSecretManagerService}`: the original remains registered and
 * Environment-configurable (the `secrets.gcp` slice) for infrastructure boot,
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
 * The secret provider is fixed by the subclass to `"gcp-secret-manager"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `GcpSecretManagerService` API.
 * @class GcpSecretManagerNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { GcpSecretManagerNodeService } from "@decaf-ts/integrations/secrets/gcp";
 *
 * const gcpSecrets = await new GcpSecretManagerNodeService().boot({
 *   projectId: "my-project",
 * });
 * ```
 * @memberOf module:integrations/secrets/gcp/node-service
 */
export class GcpSecretManagerNodeService extends nonEnvironmentService(
  GcpSecretManagerBase,
  "gcp-secret-manager"
) {}
