/**
 * @module integrations/nest/keycloakAuthHandler
 * @summary Keycloak request auth handler.
 * @description Translates Keycloak JWT payloads into Decaf-friendly auth data.
 * The base implementation handles the request-to-context plumbing, logger binding,
 * and role checks. Namespace extraction is intentionally split into a dedicated
 * subclass so provider-specific scope handling can be swapped independently.
 */
import { AuthorizationError, service } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { AuthHandler, AuthData } from "@decaf-ts/for-http/server";
import type { Context } from "@decaf-ts/core";
import { JwtService } from "@decaf-ts/crypto/integration/services/jwt";

import type {
  AuthExecutionContextLike,
  AuthRequestLike,
  KeycloakAccessTokenPayload,
} from "./types";
import {
  extractKeycloakRoles,
  extractKeycloakNamespaces,
  getRealmFromIssuer,
} from "./utils";

/**
 * Auth data returned by {@link KeycloakAuthHandler.extractFromRequest}.
 */
export interface KeycloakAuthData extends AuthData {
  /** The raw JWT extracted from the request. Empty for public routes. */
  token: string;
  /** Whether the request targets a public route (skips validation). */
  isPublic: boolean;
}

export class KeycloakAuthHandler extends AuthHandler<
  AuthExecutionContextLike,
  Context,
  KeycloakAuthData
> {
  constructor() {
    super();
  }

  @service(JwtService)
  protected readonly jwtService?: JwtService;

  protected jwt(): JwtService {
    if (!this.jwtService) {
      throw new InternalError(
        "JwtService is not available. Make sure the handler is created through Decaf service injection or assign a test double explicitly."
      );
    }
    return this.jwtService;
  }

  protected requestFromContext(ctx: AuthExecutionContextLike): AuthRequestLike {
    return ctx.switchToHttp().getRequest<AuthRequestLike>();
  }

  protected override isPublicRequest(request: AuthRequestLike): boolean {
    return isPublicRoute(request);
  }

  protected parseFromRequest(request: AuthRequestLike): KeycloakAuthData {
    if (isPublicRoute(request)) {
      return { roles: [], token: "", isPublic: true };
    }

    const token = getToken(request);
    if (!token) throw new AuthorizationError("Token not found");

    const payload = this.jwt().decodePayload<KeycloakAccessTokenPayload>(token);
    if (!payload) throw new AuthorizationError("Invalid token");

    const roles = extractKeycloakRoles(payload);
    const organization = payload.aud || payload.azp || getRealmFromIssuer(token);
    const user = payload?.email ?? payload?.preferred_username;

    return { user, organization, roles, token, isPublic: false };
  }

  protected extractFromRequest(request: AuthRequestLike): KeycloakAuthData {
    return this.parseFromRequest(request);
  }

  protected override async validateAuth(
    data: KeycloakAuthData,
    _request: AuthRequestLike
  ): Promise<void> {
    if (data.isPublic) return;
    if (!data.token) throw new AuthorizationError("Token not found");
    await this.jwt().decodeAuthToken<KeycloakAccessTokenPayload>(data.token);
  }
}

/**
 * Keycloak handler variant that also extracts namespace scopes from the token.
 */
export class KeycloakNamespaceAuthHandler extends KeycloakAuthHandler {
  protected parseFromRequest(request: AuthRequestLike): KeycloakAuthData {
    const data = super.parseFromRequest(request);
    if (data.isPublic) return data;

    const payload = this.jwt().decodePayload<KeycloakAccessTokenPayload>(data.token);
    return {
      ...data,
      namespaces: extractKeycloakNamespaces(payload),
    };
  }
}

function isPublicRoute(req: AuthRequestLike): boolean {
  if (req.path?.startsWith("/public")) return true;
  return false;
}

function getToken(req: AuthRequestLike): string | undefined {
  const token = (req.headers?.["x-auth-request-access-token"] ??
    req.headers?.["authorization"]) as string | undefined;
  if (!token) return undefined;
  return token.startsWith("Bearer ") ? token.slice("Bearer ".length) : token;
}

export { getClientRoles } from "./utils";
