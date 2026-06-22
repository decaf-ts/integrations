/**
 * @module integrations/nest/keycloakAuthHandler
 * @summary Keycloak request auth handler.
 * @description Translates Keycloak JWT payloads into Decaf-friendly auth context values.
 */
import { AuthorizationError } from "@decaf-ts/core";
import type { AuthExecutionContextLike, AuthRequestLike } from "./types";
import { AuthService } from "./authService";
import { DECAF_ADAPTER_OPTIONS, getRealmFromIssuer } from "./utils";

export class KeycloakAuthHandler {
  constructor(private readonly authService = new AuthService()) {}

  async authorize(context: AuthExecutionContextLike): Promise<void> {
    const request = context.switchToHttp().getRequest<AuthRequestLike>();

    if (request.path?.startsWith("/public")) return;
    if (request.path === "/account" && request.method === "POST") return;

    const token = getToken(request);
    if (!token) throw new AuthorizationError("Token not found");

    const payload = this.authService.assertValidToken(token);
    const roles = this.authService.getRoles(token);
    const organization = payload.aud || payload.azp || getRealmFromIssuer(token);

    request[DECAF_ADAPTER_OPTIONS] = {
      roles,
      user: payload.email ?? payload.preferred_username,
      msp: organization,
    };
  }
}

function getToken(req: AuthRequestLike): string | undefined {
  const token = (req.headers?.["x-auth-request-access-token"] ??
    req.headers?.["authorization"]) as string | undefined;
  if (!token) return undefined;
  return token.startsWith("Bearer ") ? token.slice("Bearer ".length) : token;
}
