/**
 * @module integrations/shared/http/hermetic-boot
 * @summary Environment-hermetic boot path for undecorated services used from graph nodes.
 * @description Restores the Environment-hermeticity guarantee that was lost when
 * the `nonEnvironmentService` wrappers were removed (SAA-1293 / DECAF-809): node
 * execution must never inherit configuration from a service's Environment slice
 * (SAA-1305 finding F1). {@link bootWithoutEnvironment} boots a service with an
 * explicit config while temporarily shadowing the service's own
 * `configFromEnvironment()` hook, so keys absent from the explicit config stay
 * unset instead of silently picking up Environment-derived values (e.g. a
 * `comms.email.allowPlaintextAuth` opt-in or an Environment `timeout` reaching an
 * {@link HttpApiService} node boot).
 */
import { ValidationError } from "@decaf-ts/db-decorators";

/**
 * @description Minimal boot contract required by the hermetic boot helper
 * @summary Any client-based service exposing the core `boot(...)` shape; kept
 * structural so the helper does not depend on the core service types.
 */
interface HermeticBootableService {
  boot(...args: unknown[]): Promise<unknown>;
}

/**
 * @description Name of the instance property shadowed for the hermetic boot
 * @summary Matches the `configFromEnvironment()` hook base services use to read
 * their Environment slice.
 */
const CONFIG_FROM_ENVIRONMENT = "configFromEnvironment";

/**
 * @description Boots a service with Environment-derived configuration disabled
 * @summary Node-side replacement for the removed `nonEnvironmentService`
 * wrappers (SAA-1293): the service's own `configFromEnvironment()` property
 * descriptor is shadowed with `() => undefined` for the duration of the
 * `boot()` call and restored (or removed, when the service had no own
 * descriptor) in `finally`, so configuration keys absent from
 * the explicit config cannot inherit the service's Environment slice. The
 * shadowing is per-instance (the prototype is never touched) and the helper
 * fails closed: an explicit config object is mandatory, so a node boot can
 * never silently fall back to Environment configuration. The SAA-1293
 * undecorated-service contract stands — no decoration, no wrapper classes, no
 * `Injectables` registration.
 * @param {S} service - The undecorated service instance to boot.
 * @param {CONF} config - Explicit configuration object for the boot; Environment-derived config is disabled for this call.
 * @param {...unknown} rest - Remaining `boot()` arguments (e.g. a decaf `Context`), forwarded unchanged.
 * @returns {Promise<S>} The same service instance, booted with only the explicit configuration.
 * @throws {ValidationError} When `config` is missing or not an object.
 * @example
 * ```ts
 * import { EmailService } from "@decaf-ts/integrations/comms/email";
 * import { bootWithoutEnvironment } from "@decaf-ts/integrations/shared/http";
 *
 * const service = new EmailService();
 * // The comms.email environment slice is ignored even when configured:
 * // allowPlaintextAuth stays false unless the explicit config sets it.
 * await bootWithoutEnvironment(service, {
 *   provider: "smtp",
 *   host: "smtp.example",
 *   port: 587,
 *   username: "user@example.com",
 *   password: "secret",
 * });
 * ```
 * @category Shared
 * @memberOf module:integrations/shared/http/hermetic-boot
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Helper as bootWithoutEnvironment
 *   participant Service as service
 *   Caller->>Helper: bootWithoutEnvironment(service, config, ...rest)
 *   activate Helper
 *   alt config missing or not an object
 *     Helper-->>Caller: ValidationError
 *   else explicit config present
 *     Helper->>Service: shadow own configFromEnvironment with () => undefined
 *     Helper->>Service: boot(config, ...rest)
 *     activate Service
 *     Service-->>Helper: boot completes
 *     deactivate Service
 *     Helper->>Service: restore or remove own configFromEnvironment descriptor
 *     Helper-->>Caller: service
 *   end
 *   deactivate Helper
 */
export async function bootWithoutEnvironment<
  CONF extends object,
  S extends HermeticBootableService,
>(service: S, config: CONF, ...rest: unknown[]): Promise<S> {
  if (!config || typeof config !== "object") {
    throw new ValidationError(
      "Node service boot requires an explicit configuration object; Environment configuration is disabled for node services"
    );
  }
  const target = service as S & Record<string, unknown>;
  const own = Object.getOwnPropertyDescriptor(target, CONFIG_FROM_ENVIRONMENT);
  Object.defineProperty(target, CONFIG_FROM_ENVIRONMENT, {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  try {
    await target.boot(config, ...rest);
  } finally {
    if (own) {
      Object.defineProperty(target, CONFIG_FROM_ENVIRONMENT, own);
    } else {
      delete target[CONFIG_FROM_ENVIRONMENT];
    }
  }
  return service;
}
