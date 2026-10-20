/**
 * @module integrations/shared/node-service
 * @summary Internal plumbing for non-Environment node service variants.
 * @description Provides the helpers used to derive standalone, node-style
 * service subclasses from `@service(...)`-decorated originals:
 * `serviceImplementation` resolves the undecorated implementation of a
 * registered service, `explicitNodeConfig` enforces an explicit configuration
 * object, and `nonEnvironmentService` builds a subclass that reads no
 * Environment configuration. Node service classes built here are **not**
 * `@service()`-decorated: they are not singletons and are never auto-booted
 * by static `Service.boot()`.
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Node as nonEnvironmentService subclass
 *   participant Base as Base service implementation
 *   Caller->>Node: new NodeService().boot(config)
 *   activate Node
 *   Node->>Node: explicitNodeConfig(args)
 *   alt no explicit config (missing or Context-only)
 *     Node--xCaller: ValidationError
 *   else explicit config found
 *     Node->>Node: fixed provider override (when provided)
 *     Node->>Base: super.initialize(preparedConfig, ...rest)
 *     activate Base
 *     Base-->>Node: { config, client }
 *     deactivate Base
 *     Node-->>Caller: booted service
 *   end
 *   deactivate Node
 */
import { Injectables } from "@decaf-ts/injectable-decorators";
import { InternalError, ValidationError } from "@decaf-ts/db-decorators";
import { Context } from "@decaf-ts/core";

type AnyConstructor = { prototype: object };

/**
 * @description Structural guard for decaf `Context`-like arguments
 * @summary Returns whether the value duck-types the `Context` API surface
 * (`get`, `accumulate`, `override`, `toOverrides`), used by
 * `explicitNodeConfig` to tell a configuration object apart from a `Context`
 * argument even when the `Context` class identity differs across builds.
 * @param {unknown} value - The value to inspect.
 * @returns {boolean} `true` when the value looks like a decaf `Context`.
 */
function isContextLike(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    get?: unknown;
    accumulate?: unknown;
    override?: unknown;
    toOverrides?: unknown;
  };
  return (
    typeof candidate.get === "function" &&
    typeof candidate.accumulate === "function" &&
    typeof candidate.override === "function" &&
    typeof candidate.toOverrides === "function"
  );
}

/**
 * @description Resolves the undecorated implementation of a registered service
 * @summary `@service(...)` replaces the exported constructor with an
 * injectable factory, so extending the decorated export directly extends the
 * registered parent singleton (see
 * `src/blob/s3/S3CompatibleBlobStoreService.ts` for the documented failure
 * mode). `Injectables.services()` exposes the undecorated original
 * constructor registered under `serviceKey`, and this helper returns it so
 * node service subclasses can extend the real implementation while the
 * original stays `@service(...)`-decorated and Environment-configurable.
 * @param {string} serviceKey - The key the service was registered under (e.g. `"slack"`, `"blob-s3"`).
 * @param {C} decorated - The `@service(...)`-decorated export, used only to name the service in the error message.
 * @returns {C} The undecorated original constructor.
 * @throws {InternalError} When no implementation is registered under `serviceKey` (typically because the service module has not been imported yet).
 */
export function serviceImplementation<C extends AnyConstructor>(
  serviceKey: string,
  decorated: C
): C {
  const services = (
    Injectables as unknown as {
      services?: () => Record<string, AnyConstructor>;
    }
  ).services?.();
  const implementation = services?.[serviceKey];
  if (!implementation) {
    throw new InternalError(
      `No undecorated implementation found for service '${serviceKey}' while preparing '${(decorated as unknown as { name?: string }).name ?? serviceKey}'. Import the service module before creating its node subclass.`
    );
  }
  return implementation as C;
}

/**
 * @description Extracts the explicit configuration argument for a node service
 * @summary Scans the `boot()`/`initialize()` arguments for the first plain
 * object that is neither `undefined`/`null` nor a decaf `Context` (or a
 * `Context`-like value, per `isContextLike`) and returns it as the explicit
 * configuration. Node services must be booted as
 * `await instance.boot(config)`; when no explicit configuration object is
 * present — no arguments at all, or only a `Context` — it throws, because
 * Environment configuration is disabled for node services.
 * @param {string} serviceName - The service name used in the error message.
 * @param {unknown[]} args - The raw `boot()`/`initialize()` arguments.
 * @returns {T} The explicit configuration object.
 * @throws {ValidationError} When no explicit configuration object is supplied.
 */
export function explicitNodeConfig<T extends object>(
  serviceName: string,
  args: unknown[]
): T {
  const candidate = (args || []).find(
    (arg) =>
      arg &&
      typeof arg === "object" &&
      !(arg instanceof Context) &&
      !isContextLike(arg)
  );
  if (!candidate) {
    throw new ValidationError(
      `${serviceName} node service requires an explicit configuration object; Environment configuration is disabled for node services`
    );
  }
  return candidate as T;
}

/**
 * @description Builds a non-Environment node service class from a base implementation
 * @summary Returns a new class extending `Base` that disables Environment
 * configuration and requires an explicit configuration object at boot:
 *
 * - `configFromEnvironment()` returns `undefined`, so no Environment slice is
 *   consulted during `initialize()`;
 * - `initialize(...)` validates its arguments through `explicitNodeConfig`
 *   and rejects with a `ValidationError` when no explicit config object is
 *   provided (no-argument or `Context`-only boot);
 * - when a fixed `provider` is supplied, it overrides any `provider` in the
 *   explicit config before delegating (used by the blob and secret node
 *   services, whose provider is fixed by the subclass);
 * - arguments other than the extracted config (e.g. a trailing decaf
 *   `Context`) are forwarded unchanged to `super.initialize(...)`.
 *
 * The returned class is **not** `@service()`-decorated: it is not registered
 * in `Injectables`, not a singleton, and never auto-booted by static
 * `Service.boot()`.
 * @template C - The undecorated service implementation constructor type.
 * @param {C} Base - The undecorated service implementation to extend (see `serviceImplementation`).
 * @param {string} [provider] - Optional fixed provider identifier injected into the config, overriding any `provider` in the supplied configuration.
 * @returns {new (...args: any[]) => C["prototype"]} A constructible, non-Environment node service class.
 */
export function nonEnvironmentService<C extends AnyConstructor>(
  Base: C,
  provider?: string
): new (...args: any[]) => C["prototype"] {
  class NonEnvironmentService extends (Base as any) {
    protected configFromEnvironment(): undefined {
      return undefined;
    }

    async initialize(...args: any[]): Promise<any> {
      const config = explicitNodeConfig<Record<string, unknown>>(
        this.constructor.name,
        args
      );
      const prepared = provider ? { ...config, provider } : config;
      return super.initialize(
        prepared,
        ...args.filter((arg) => arg !== config)
      );
    }
  }
  return NonEnvironmentService as unknown as new (
    ...args: any[]
  ) => C["prototype"];
}
