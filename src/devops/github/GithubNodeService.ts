/**
 * @module integrations/devops/github/node-service
 * @summary Non-Environment node variant of the GitHub.
 * @description Exposes `{@link GithubNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GithubService` implementation resolved
 * via `serviceImplementation("github", GithubService)` rather than the
 * `@service("github")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GithubService } from "./GithubService";

const GithubBase = serviceImplementation("github", GithubService);

/**
 * @description Non-Environment node variant of the GitHub
 * @summary Standalone subclass of the undecorated `GithubService` implementation,
 * resolved through `serviceImplementation("github", GithubService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("github")`-decorated
 * `{@link GithubService}`: the original remains registered and
 * Environment-configurable (the `devops.github` slice) for infrastructure boot,
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
 *
 * Once booted, instances expose the full `GithubService` API.
 * @class GithubNodeService
 * @category DevOps
 * @example
 * ```ts
 * import { GithubNodeService } from "@decaf-ts/integrations/devops/github";
 *
 * const github = await new GithubNodeService().boot({
 *   token: process.env.GITHUB_TOKEN,
 *   owner: "acme",
 *   repo: "app",
 * });
 * ```
 * @memberOf module:integrations/devops/github/node-service
 */
export class GithubNodeService extends nonEnvironmentService(GithubBase) {}
