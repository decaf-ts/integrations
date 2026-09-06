/**
 * @module integrations/nest/keycloakModule
 * @summary Nest module wiring for Keycloak auth.
 * @description Exposes the Nest module setup for the Keycloak auth handlers.
 */
import { KeycloakAuthHandler, KeycloakNamespaceAuthHandler } from "./keycloakAuthHandler";

export type KeycloakModuleOptions = {
  /**
   * When enabled, the auth handler emits OCSF-style action logs (class_uid
   * 3001 auth attempts / 3002 session boundaries) via the logger's `action()`
   * API so they can be indexed for BI.
   */
  logAccess?: boolean;
};

export class KeycloakModule {
  constructor(
    public readonly authHandler: KeycloakAuthHandler
  ) {}

  static create(options: KeycloakModuleOptions = {}): KeycloakModule {
    const authHandler = new KeycloakNamespaceAuthHandler();
    if (options.logAccess) authHandler.logAccess = true;
    return new KeycloakModule(authHandler);
  }
}

export class AuthModule extends KeycloakModule {}
