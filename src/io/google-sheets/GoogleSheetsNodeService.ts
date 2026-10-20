/**
 * @module integrations/io/google-sheets/node-service
 * @summary Non-Environment node variant of the Google Sheets.
 * @description Exposes `{@link GoogleSheetsNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `GoogleSheetsService` implementation resolved
 * via `serviceImplementation("google-sheets", GoogleSheetsService)` rather than the
 * `@service("google-sheets")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { GoogleSheetsService } from "./GoogleSheetsService";

const GoogleSheetsBase = serviceImplementation(
  "google-sheets",
  GoogleSheetsService
);

/**
 * @description Non-Environment node variant of the Google Sheets
 * @summary Standalone subclass of the undecorated `GoogleSheetsService` implementation,
 * resolved through `serviceImplementation("google-sheets", GoogleSheetsService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("google-sheets")`-decorated
 * `{@link GoogleSheetsService}`: the original remains registered and
 * Environment-configurable (the `io.googleSheets` slice) for infrastructure boot,
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
 * Once booted, instances expose the full `GoogleSheetsService` API.
 * @class GoogleSheetsNodeService
 * @category IO
 * @example
 * ```ts
 * import { GoogleSheetsNodeService } from "@decaf-ts/integrations/io/google-sheets";
 *
 * const sheets = await new GoogleSheetsNodeService().boot({
 *   apiKey: process.env.GOOGLE_API_KEY,
 * });
 * ```
 * @memberOf module:integrations/io/google-sheets/node-service
 */
export class GoogleSheetsNodeService extends nonEnvironmentService(
  GoogleSheetsBase
) {}
