/**
 * @module integrations/io/airtable/node-service
 * @summary Non-Environment node variant of the Airtable.
 * @description Exposes `{@link AirtableNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `AirtableService` implementation resolved
 * via `serviceImplementation("airtable", AirtableService)` rather than the
 * `@service("airtable")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { AirtableService } from "./AirtableService";

const AirtableBase = serviceImplementation("airtable", AirtableService);

/**
 * @description Non-Environment node variant of the Airtable
 * @summary Standalone subclass of the undecorated `AirtableService` implementation,
 * resolved through `serviceImplementation("airtable", AirtableService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("airtable")`-decorated
 * `{@link AirtableService}`: the original remains registered and
 * Environment-configurable (the `io.airtable` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `AirtableService` API.
 * @class AirtableNodeService
 * @category IO
 * @example
 * ```ts
 * import { AirtableNodeService } from "@decaf-ts/integrations/io/airtable";
 *
 * const airtable = await new AirtableNodeService().boot({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 * });
 * ```
 * @memberOf module:integrations/io/airtable/node-service
 */
export class AirtableNodeService extends nonEnvironmentService(AirtableBase) {}
