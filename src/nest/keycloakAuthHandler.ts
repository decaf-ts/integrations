/**
 * @module integrations/nest/keycloakAuthHandler
 * @summary Keycloak request auth handler.
 * @description Translates Keycloak JWT payloads into Decaf-friendly auth data.
 * Extends the framework-agnostic {@link AuthHandler} from `@decaf-ts/for-http/server`.
 *
 * Only overrides the two extension points:
 * - {@link extractFromAuth} — decodes the JWT and returns auth data (no validation).
 *   Returns empty data for public routes without requiring a token.
 * - {@link validate} — validates the JWT via {@link AuthService.assertValidToken},
 *   then delegates to the base class for route-level and model-level role checks.
 *   Skips entirely for public routes.
 *
 * Does NOT override `bindToContext` — the base class default `ctx.accumulate(data)`
 * is sufficient. Does NOT override `authorize`.
 */
import type { Constructor } from "@decaf-ts/decoration";
import { AuthorizationError, Context, ContextualArgs } from "@decaf-ts/core";
import { AuthHandler, AuthData } from "@decaf-ts/for-http/server";

import { AuthService } from "./authService";
import type { AuthExecutionContextLike, AuthRequestLike } from "./types";
import {
  getRealmFromIssuer,
  getTokenPayload,
  extractKeycloakRoles,
} from "./utils";

/**
 * Auth data returned by {@link KeycloakAuthHandler.extractFromAuth}.
 *
 * Carries the raw JWT `token` so that {@link KeycloakAuthHandler.validate} can
 * validate it against the Keycloak instance (signature, expiry, revocation, etc.).
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
  constructor(private readonly authService = new AuthService()) {
    super();
  }

  protected extractFromAuth(ctx: AuthExecutionContextLike): KeycloakAuthData {
    const request = ctx.switchToHttp().getRequest<AuthRequestLike>();

    if (isPublicRoute(request)) {
      return { roles: [], token: "", isPublic: true };
    }

    const token = getToken(request);
    if (!token) throw new AuthorizationError("Token not found");

    // Decode only — validation happens in `validate`
    const payload = getTokenPayload(token);
    const roles = extractKeycloakRoles(payload);
    const organization = resolveOrganization(payload, token);
    const user = payload?.email ?? payload?.preferred_username;

    return { user, organization, roles, token, isPublic: false };
  }

  /**
   * Validates the JWT against the Keycloak instance (signature, expiry, etc.)
   * via {@link AuthService.assertValidToken}, then delegates to the base class
   * for route-level and model-level role checks. Skips entirely for public routes.
   */
  protected override async validate(
    data: KeycloakAuthData,
    routeRoles: string[] | undefined,
    model: string | Constructor,
    ...args: ContextualArgs<Context>
  ): Promise<void> {
    if (data.isPublic) return;
    this.authService.assertValidToken(data.token);
    await super.validate(data, routeRoles, model, ...args);
  }
}

function isPublicRoute(req: AuthRequestLike): boolean {
  if (req.path?.startsWith("/public")) return true;
  if (req.path === "/account" && req.method === "POST") return true;
  return false;
}

function getToken(req: AuthRequestLike): string | undefined {
  const token = (req.headers?.["x-auth-request-access-token"] ??
    req.headers?.["authorization"]) as string | undefined;
  if (!token) return undefined;
  return token.startsWith("Bearer ") ? token.slice("Bearer ".length) : token;
}

function resolveOrganization(
  payload: { aud?: string; azp?: string } | null,
  token: string
): string {
  if (payload?.aud) return payload.aud;
  if (payload?.azp) return payload.azp;
  return getRealmFromIssuer(token);
}
