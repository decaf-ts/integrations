/**
 * @module integrations/secrets/fs/node-service
 * @summary Non-Environment node variant of the filesystem secret service.
 * @description Exposes `{@link FsSecretNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `FsSecretService` implementation resolved
 * via `serviceImplementation("secret-fs", FsSecretService)` rather than the
 * `@service("secret-fs")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { FsSecretService } from "./FsSecretService";

const FsSecretBase = serviceImplementation("secret-fs", FsSecretService);

/**
 * @description Non-Environment node variant of the filesystem secret service
 * @summary Standalone subclass of the undecorated `FsSecretService` implementation,
 * resolved through `serviceImplementation("secret-fs", FsSecretService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-fs")`-decorated
 * `{@link FsSecretService}`: the original remains registered and
 * Environment-configurable (the `secrets.fs` slice) for infrastructure boot,
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
 * The secret provider is fixed by the subclass to `"filesystem"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `FsSecretService` API.
 * @class FsSecretNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { FsSecretNodeService } from "@decaf-ts/integrations/secrets";
 *
 * const fsSecrets = await new FsSecretNodeService().boot({
 *   rootPath: "/var/lib/decaf/secrets",
 *   keySecret: "fs-master-key",
 * });
 * ```
 * @memberOf module:integrations/secrets/fs/node-service
 */
export class FsSecretNodeService extends nonEnvironmentService(
  FsSecretBase,
  "filesystem"
) {}
