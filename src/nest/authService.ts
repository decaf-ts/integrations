import { AuthorizationError } from "@decaf-ts/core";
import { extractKeycloakRoles, getRealmFromIssuer, getTokenPayload, getUser } from "./utils";
import type { KeycloakAccessTokenPayload, KeycloakUser } from "./types";

export class AuthService {
  getTokenPayload(jwt: string): KeycloakAccessTokenPayload | null {
    return getTokenPayload(jwt);
  }

  getRoles(jwt: string): string[] {
    return extractKeycloakRoles(this.getTokenPayload(jwt));
  }

  getUser(jwt: string): KeycloakUser | undefined {
    return getUser(jwt);
  }

  extractKeycloakRoles(payload: unknown): string[] {
    return extractKeycloakRoles(payload as KeycloakAccessTokenPayload | null);
  }

  getRealmFromIssuer(jwt: string): string {
    return getRealmFromIssuer(jwt);
  }

  assertValidToken(jwt: string): KeycloakAccessTokenPayload {
    const payload = this.getTokenPayload(jwt);
    if (!payload) {
      throw new AuthorizationError("Invalid token");
    }
    return payload;
  }
}
