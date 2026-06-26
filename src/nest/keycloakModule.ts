/**
 * @module integrations/nest/keycloakModule
 * @summary Nest module wiring for Keycloak auth.
 * @description Exposes the Nest module setup for the integration auth service and Keycloak handler.
 */
import { AuthService, type AuthServiceOptions } from "./authService";
import { KeycloakAuthHandler } from "./keycloakAuthHandler";

export class KeycloakModule {
  constructor(
    public readonly authService: AuthService,
    public readonly authHandler: KeycloakAuthHandler
  ) {}

  static create(options?: AuthServiceOptions): KeycloakModule {
    const authService = new AuthService(options);
    const authHandler = new KeycloakAuthHandler(authService);
    return new KeycloakModule(authService, authHandler);
  }
}

export class AuthModule extends KeycloakModule {}
