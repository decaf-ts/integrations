/**
 * @module integrations/comms/gmail/node-service
 * @summary Non-Environment node variant of the Gmail.
 * @description Exposes `{@link GmailNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GmailService` implementation resolved
 * via `serviceImplementation("gmail", GmailService)` rather than the
 * `@service("gmail")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GmailService } from "./GmailService";

const GmailBase = serviceImplementation("gmail", GmailService);

/**
 * @description Non-Environment node variant of the Gmail
 * @summary Standalone subclass of the undecorated `GmailService` implementation,
 * resolved through `serviceImplementation("gmail", GmailService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("gmail")`-decorated
 * `{@link GmailService}`: the original remains registered and
 * Environment-configurable (the `comms.gmail` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `GmailService` API.
 * @class GmailNodeService
 * @category Comms
 * @example
 * ```ts
 * import { GmailNodeService } from "@decaf-ts/integrations/comms/gmail";
 *
 * const gmail = await new GmailNodeService().boot({
 *   token: process.env.GMAIL_OAUTH_TOKEN,
 * });
 * ```
 * @memberOf module:integrations/comms/gmail/node-service
 */
export class GmailNodeService extends nonEnvironmentService(GmailBase) {}
