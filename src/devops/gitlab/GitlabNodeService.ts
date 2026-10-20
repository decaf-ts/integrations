/**
 * @module integrations/devops/gitlab/node-service
 * @summary Non-Environment node variant of the GitLab.
 * @description Exposes `{@link GitlabNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GitlabService` implementation resolved
 * via `serviceImplementation("gitlab", GitlabService)` rather than the
 * `@service("gitlab")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GitlabService } from "./GitlabService";

const GitlabBase = serviceImplementation("gitlab", GitlabService);

/**
 * @description Non-Environment node variant of the GitLab
 * @summary Standalone subclass of the undecorated `GitlabService` implementation,
 * resolved through `serviceImplementation("gitlab", GitlabService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("gitlab")`-decorated
 * `{@link GitlabService}`: the original remains registered and
 * Environment-configurable (the `devops.gitlab` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `GitlabService` API.
 * @class GitlabNodeService
 * @category DevOps
 * @example
 * ```ts
 * import { GitlabNodeService } from "@decaf-ts/integrations/devops/gitlab";
 *
 * const gitlab = await new GitlabNodeService().boot({
 *   token: process.env.GITLAB_TOKEN,
 *   projectId: "acme/app",
 * });
 * ```
 * @memberOf module:integrations/devops/gitlab/node-service
 */
export class GitlabNodeService extends nonEnvironmentService(GitlabBase) {}
