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
