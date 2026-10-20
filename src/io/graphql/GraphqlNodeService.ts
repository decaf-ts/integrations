/**
 * @module integrations/io/graphql/node-service
 * @summary Non-Environment node variant of the GraphQL.
 * @description Exposes `{@link GraphqlNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GraphqlService` implementation resolved
 * via `serviceImplementation("graphql", GraphqlService)` rather than the
 * `@service("graphql")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GraphqlService } from "./GraphqlService";

const GraphqlBase = serviceImplementation("graphql", GraphqlService);

/**
 * @description Non-Environment node variant of the GraphQL
 * @summary Standalone subclass of the undecorated `GraphqlService` implementation,
 * resolved through `serviceImplementation("graphql", GraphqlService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("graphql")`-decorated
 * `{@link GraphqlService}`: the original remains registered and
 * Environment-configurable (the `io.graphql` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `GraphqlService` API.
 * @class GraphqlNodeService
 * @category IO
 * @example
 * ```ts
 * import { GraphqlNodeService } from "@decaf-ts/integrations/io/graphql";
 *
 * const graphql = await new GraphqlNodeService().boot({
 *   endpoint: "https://api.example.com/graphql",
 *   token: process.env.GRAPHQL_TOKEN,
 * });
 * ```
 * @memberOf module:integrations/io/graphql/node-service
 */
export class GraphqlNodeService extends nonEnvironmentService(GraphqlBase) {}
