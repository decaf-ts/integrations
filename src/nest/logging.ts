/**
 * @module integrations/nest/logging
 * @summary Keycloak auth log parameters.
 * @description Registers `user` and `organization` as log parameters sourced from the
 * logging config (populated by the auth interceptor's child logger via `Logging.for({ user, organization })`).
 *
 * These parameters are registered here — in `integrations/nest` — because this is the
 * layer that extracts user/organization identity from Keycloak JWTs. The `ip` parameter,
 * by contrast, is registered in `@decaf-ts/for-http/server` where the HTTP request IP is
 * available.
 */
import { logParameterRegistry } from "@decaf-ts/logging";

logParameterRegistry
  .register({
    key: "user",
    shouldInclude(payload) {
      return Boolean((payload.config as Record<string, unknown>).user);
    },
    render(payload) {
      return String((payload.config as Record<string, unknown>).user);
    },
    style(rendered, payload) {
      return payload.applyTheme(rendered, "app");
    },
  })
  .register({
    key: "organization",
    shouldInclude(payload) {
      return Boolean((payload.config as Record<string, unknown>).organization);
    },
    render(payload) {
      return String((payload.config as Record<string, unknown>).organization);
    },
    style(rendered, payload) {
      return payload.applyTheme(rendered, "app");
    },
  });
