/**
 * @module integrations/comms/telegram/node-service
 * @summary Non-Environment node variant of the Telegram.
 * @description Exposes `{@link TelegramNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `TelegramService` implementation resolved
 * via `serviceImplementation("telegram", TelegramService)` rather than the
 * `@service("telegram")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { TelegramService } from "./TelegramService";

const TelegramBase = serviceImplementation("telegram", TelegramService);

/**
 * @description Non-Environment node variant of the Telegram
 * @summary Standalone subclass of the undecorated `TelegramService` implementation,
 * resolved through `serviceImplementation("telegram", TelegramService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("telegram")`-decorated
 * `{@link TelegramService}`: the original remains registered and
 * Environment-configurable (the `comms.telegram` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `TelegramService` API.
 * @class TelegramNodeService
 * @category Comms
 * @example
 * ```ts
 * import { TelegramNodeService } from "@decaf-ts/integrations/comms/telegram";
 *
 * const telegram = await new TelegramNodeService().boot({
 *   token: process.env.TELEGRAM_BOT_TOKEN,
 * });
 * ```
 * @memberOf module:integrations/comms/telegram/node-service
 */
export class TelegramNodeService extends nonEnvironmentService(TelegramBase) {}
