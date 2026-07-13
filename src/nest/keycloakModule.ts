/**
 * @module integrations/nest/keycloakModule
 * @summary Nest module wiring for Keycloak auth.
 * @description Exposes the Nest module setup for the Keycloak auth handlers.
 */
import { KeycloakAuthHandler, KeycloakNamespaceAuthHandler } from "./keycloakAuthHandler";

export class KeycloakModule {
  constructor(
    public readonly authHandler: KeycloakAuthHandler
  ) {}

  static create(): KeycloakModule {
    const authHandler = new KeycloakNamespaceAuthHandler();
    return new KeycloakModule(authHandler);
  }
}

export class AuthModule extends KeycloakModule {}
