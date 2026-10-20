/**
 * @module integrations/secrets/model/node-service
 * @summary Non-Environment node variant of the model-backed secret service.
 * @description Exposes `{@link ModelSecretNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `ModelSecretService` implementation resolved
 * via `serviceImplementation("secret-model", ModelSecretService)` rather than the
 * `@service("secret-model")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { ModelSecretService } from "./ModelSecretService";

const ModelSecretBase = serviceImplementation(
  "secret-model",
  ModelSecretService
);

/**
 * @description Non-Environment node variant of the model-backed secret service
 * @summary Standalone subclass of the undecorated `ModelSecretService` implementation,
 * resolved through `serviceImplementation("secret-model", ModelSecretService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-model")`-decorated
 * `{@link ModelSecretService}`: the original remains registered and
 * Environment-configurable (the `secrets.model` slice) for infrastructure boot,
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
 * The secret provider is fixed by the subclass to `"model"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `ModelSecretService` API.
 * @class ModelSecretNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { ModelSecretNodeService } from "@decaf-ts/integrations/secrets";
 *
 * const modelSecrets = await new ModelSecretNodeService().boot({
 *   keySecret: "model-master-key",
 * });
 * ```
 * @memberOf module:integrations/secrets/model/node-service
 */
export class ModelSecretNodeService extends nonEnvironmentService(
  ModelSecretBase,
  "model"
) {}
