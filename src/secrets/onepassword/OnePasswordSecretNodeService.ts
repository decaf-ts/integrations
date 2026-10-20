/**
 * @module integrations/secrets/onepassword/node-service
 * @summary Non-Environment node variant of the 1Password.
 * @description Exposes `{@link OnePasswordSecretNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `OnePasswordSecretService` implementation resolved
 * via `serviceImplementation("secret-onepassword", OnePasswordSecretService)` rather than the
 * `@service("secret-onepassword")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { OnePasswordSecretService } from "./OnePasswordSecretService";

const OnePasswordSecretBase = serviceImplementation(
  "secret-onepassword",
  OnePasswordSecretService
);

/**
 * @description Non-Environment node variant of the 1Password
 * @summary Standalone subclass of the undecorated `OnePasswordSecretService` implementation,
 * resolved through `serviceImplementation("secret-onepassword", OnePasswordSecretService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-onepassword")`-decorated
 * `{@link OnePasswordSecretService}`: the original remains registered and
 * Environment-configurable (the `secrets.onePassword` slice) for infrastructure boot,
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
 * The secret provider is fixed by the subclass to `"1password"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `OnePasswordSecretService` API.
 * @class OnePasswordSecretNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { OnePasswordSecretNodeService } from "@decaf-ts/integrations/secrets/onepassword";
 *
 * const onePassword = await new OnePasswordSecretNodeService().boot({
 *   connectHost: "http://onepassword-connect.default:8080",
 *   connectToken: process.env.OP_CONNECT_TOKEN,
 * });
 * ```
 * @memberOf module:integrations/secrets/onepassword/node-service
 */
export class OnePasswordSecretNodeService extends nonEnvironmentService(
  OnePasswordSecretBase,
  "1password"
) {}
