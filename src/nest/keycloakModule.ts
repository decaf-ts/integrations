/**
 * @module integrations/nest/keycloakModule
 * @summary Nest module wiring for Keycloak auth.
 * @description Exposes the Nest module setup for the integration auth service and Keycloak handler.
 */
import { AuthService } from "./authService";
import { KeycloakAuthHandler } from "./keycloakAuthHandler";

export class KeycloakModule {
  constructor(
    public readonly authService = new AuthService(),
    public readonly authHandler = new KeycloakAuthHandler(authService)
  ) {}

  static create(): KeycloakModule {
    return new KeycloakModule();
  }
}

export class AuthModule extends KeycloakModule {}
