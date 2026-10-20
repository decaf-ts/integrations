/**
 * @module integrations/comms/teams/node-service
 * @summary Non-Environment node variant of the Microsoft Teams.
 * @description Exposes `{@link TeamsNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `TeamsService` implementation resolved
 * via `serviceImplementation("teams", TeamsService)` rather than the
 * `@service("teams")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { TeamsService } from "./TeamsService";

const TeamsBase = serviceImplementation("teams", TeamsService);

/**
 * @description Non-Environment node variant of the Microsoft Teams
 * @summary Standalone subclass of the undecorated `TeamsService` implementation,
 * resolved through `serviceImplementation("teams", TeamsService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("teams")`-decorated
 * `{@link TeamsService}`: the original remains registered and
 * Environment-configurable (the `comms.teams` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `TeamsService` API.
 * @class TeamsNodeService
 * @category Comms
 * @example
 * ```ts
 * import { TeamsNodeService } from "@decaf-ts/integrations/comms/teams";
 *
 * const teams = await new TeamsNodeService().boot({
 *   token: process.env.MS_GRAPH_TOKEN,
 * });
 * ```
 * @memberOf module:integrations/comms/teams/node-service
 */
export class TeamsNodeService extends nonEnvironmentService(TeamsBase) {}
