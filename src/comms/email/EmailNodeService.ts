/**
 * @module integrations/comms/email/node-service
 * @summary Non-Environment node variant of the Email.
 * @description Exposes `{@link EmailNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `EmailService` implementation resolved
 * via `serviceImplementation("email", EmailService)` rather than the
 * `@service("email")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { EmailService } from "./EmailService";

const EmailBase = serviceImplementation("email", EmailService);

/**
 * @description Non-Environment node variant of the Email
 * @summary Standalone subclass of the undecorated `EmailService` implementation,
 * resolved through `serviceImplementation("email", EmailService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("email")`-decorated
 * `{@link EmailService}`: the original remains registered and
 * Environment-configurable (the `comms.email` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `EmailService` API.
 * @class EmailNodeService
 * @category Comms
 * @example
 * ```ts
 * import { EmailNodeService } from "@decaf-ts/integrations/comms/email";
 *
 * const email = await new EmailNodeService().boot({
 *   host: "smtp.example.com",
 *   port: 587,
 *   username: "noreply@example.com",
 *   password: process.env.SMTP_PASSWORD,
 *   from: "noreply@example.com",
 * });
 * ```
 * @memberOf module:integrations/comms/email/node-service
 */
export class EmailNodeService extends nonEnvironmentService(EmailBase) {}
