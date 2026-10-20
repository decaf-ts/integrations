/**
 * @module integrations/comms/slack/node-service
 * @summary Non-Environment node variant of the Slack.
 * @description Exposes `{@link SlackNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `SlackService` implementation resolved
 * via `serviceImplementation("slack", SlackService)` rather than the
 * `@service("slack")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { SlackService } from "./SlackService";

const SlackBase = serviceImplementation("slack", SlackService);

/**
 * @description Non-Environment node variant of the Slack
 * @summary Standalone subclass of the undecorated `SlackService` implementation,
 * resolved through `serviceImplementation("slack", SlackService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("slack")`-decorated
 * `{@link SlackService}`: the original remains registered and
 * Environment-configurable (the `comms.slack` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `SlackService` API.
 * @class SlackNodeService
 * @category Comms
 * @example
 * ```ts
 * import { SlackNodeService } from "@decaf-ts/integrations/comms/slack";
 *
 * const slack = await new SlackNodeService().boot({
 *   token: process.env.SLACK_BOT_TOKEN,
 *   baseUrl: "https://slack.com/api",
 * });
 * await slack.postMessage({ channel: "#general", text: "Deployed!" });
 * ```
 * @memberOf module:integrations/comms/slack/node-service
 */
export class SlackNodeService extends nonEnvironmentService(SlackBase) {}
