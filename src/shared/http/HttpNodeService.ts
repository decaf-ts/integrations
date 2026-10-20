/**
 * @module integrations/shared/http/node-service
 * @summary Non-Environment node variant of the generic HTTP service.
 * @description Exposes {@link HttpNodeService}: a standalone
 * {@link HttpApiService} subclass for arbitrary HTTP endpoints, initialized
 * explicitly with `boot(config)` instead of Environment configuration. It is
 * not `@service()`-decorated, so it is neither a singleton nor auto-booted by
 * static `Service.boot()`.
 */
import { explicitNodeConfig } from "../node-service";
import {
  HttpApiService,
  type HttpApiServiceConfig,
} from "./HttpApiService";

/**
 * @description Non-Environment node variant of the generic HTTP service
 * @summary A standalone {@link HttpApiService} subclass for pointing at
 * arbitrary HTTP endpoints from node code. Unlike the family node services
 * built with `nonEnvironmentService`, this class extends
 * {@link HttpApiService} directly and re-validates the explicit configuration
 * through `explicitNodeConfig` before delegating to the base `initialize()`.
 *
 * - It is **not** `@service()`-decorated: it is not registered in
 *   `Injectables`, not a singleton, and never auto-booted by static
 *   `Service.boot()`.
 * - `configFromEnvironment()` returns `undefined`, so it must be initialized
 *   explicitly with `await instance.boot(config)`; booting with no arguments
 *   or with only a decaf `Context` rejects with a `ValidationError`.
 * - A `baseUrl` is mandatory: `defaultBaseUrl()` returns an empty string, so
 *   the base `initialize()` throws an `InternalError` when the resolved
 *   config carries no `baseUrl`.
 * @class HttpNodeService
 * @category Shared
 * @example
 * ```ts
 * import { HttpNodeService } from "@decaf-ts/integrations/shared/http";
 *
 * const http = await new HttpNodeService().boot({
 *   baseUrl: "https://api.example.com",
 * });
 * ```
 * @memberOf module:integrations/shared/http/node-service
 */
export class HttpNodeService extends HttpApiService<HttpApiServiceConfig> {
  protected readonly serviceName = "Http";

  protected defaultBaseUrl(): string {
    return "";
  }

  protected override configFromEnvironment(): undefined {
    return undefined;
  }

  override async initialize(...args: any[]) {
    explicitNodeConfig("Http", args);
    return super.initialize(...args);
  }
}
