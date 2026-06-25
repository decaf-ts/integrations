/**
 * @module integrations/nest/keycloakAuthHandler
 * @summary Keycloak request auth handler.
 * @description Translates Keycloak JWT payloads into Decaf-friendly auth context values.
 * Extends the framework-agnostic {@link AuthHandler} from `@decaf-ts/for-http/server`,
 * overriding `extractFromAuth` to parse Keycloak JWTs and `bindToContext` to also
 * populate `DECAF_ADAPTER_OPTIONS` on the request for persistence-layer overrides.
 */
import type { Constructor } from "@decaf-ts/decoration";
import { AuthorizationError, Context, ContextualArgs } from "@decaf-ts/core";
import { AuthHandler, AuthData } from "@decaf-ts/for-http/server";

import { AuthService } from "./authService";
import type { AuthExecutionContextLike, AuthRequestLike } from "./types";
import { DECAF_ADAPTER_OPTIONS, getRealmFromIssuer } from "./utils";

export class KeycloakAuthHandler extends AuthHandler<
  AuthExecutionContextLike,
  Context
> {
  constructor(private readonly authService = new AuthService()) {
    super();
  }

  /**
   * Bypasses auth for public routes before delegating to the base class
   * `authorize` which orchestrates extraction → role checks → binding.
   */
  override async authorize(
    ctx: AuthExecutionContextLike,
    model: string | Constructor,
    ...args: ContextualArgs<Context, [string[]?]>
  ): Promise<void> {
    const request = ctx.switchToHttp().getRequest<AuthRequestLike>();
    if (request.path?.startsWith("/public")) return;
    if (request.path === "/account" && request.method === "POST") return;
    return super.authorize(ctx, model, ...args);
  }

  protected extractFromAuth(ctx: AuthExecutionContextLike): AuthData {
    const request = ctx.switchToHttp().getRequest<AuthRequestLike>();
    const token = getToken(request);
    if (!token) throw new AuthorizationError("Token not found");

    const payload = this.authService.assertValidToken(token);
    const roles = this.authService.getRoles(token);
    const organization = resolveOrganization(payload, token);
    const user = payload.email ?? payload.preferred_username;

    return { user, organization, roles };
  }

  protected bindToContext(
    context: Context,
    data: AuthData,
    ctx?: AuthExecutionContextLike
  ): void {
    context.accumulate({
      UUID: data.user,
      organization: data.organization,
    });
    if (ctx) {
      const request = ctx.switchToHttp().getRequest<AuthRequestLike>();
      request[DECAF_ADAPTER_OPTIONS] = {
        roles: data.roles,
        user: data.user,
        msp: data.organization,
      };
    }
  }
}

function getToken(req: AuthRequestLike): string | undefined {
  const token = (req.headers?.["x-auth-request-access-token"] ??
    req.headers?.["authorization"]) as string | undefined;
  if (!token) return undefined;
  return token.startsWith("Bearer ") ? token.slice("Bearer ".length) : token;
}

function resolveOrganization(
  payload: { aud?: string; azp?: string },
  token: string
): string {
  if (payload.aud) return payload.aud;
  if (payload.azp) return payload.azp;
  return getRealmFromIssuer(token);
}
