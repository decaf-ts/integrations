/**
 * @module integrations/nest/types
 * @summary Nest integration types.
 * @description Keycloak-specific payload types, a platform-specific execution context
 * type, and re-exports of the framework-agnostic auth primitives from
 * `@decaf-ts/for-http/server`.
 */
import type { AuthData, AuthRequestLike } from "@decaf-ts/for-http/server";

export type { AuthData, AuthRequestLike };

/**
 * Structural subset of a NestJS-like execution context that exposes the HTTP request.
 *
 * Defined here (not in for-http) because the base `AuthHandler` class is intentionally
 * generic over its execution context — only the platform that consumes it needs to know
 * the concrete shape.
 */
export interface AuthExecutionContextLike {
  switchToHttp(): { getRequest<T = AuthRequestLike>(): T };
  getHandler?(): { name?: string };
  getClass?(): { name?: string };
}

export interface KeycloakAccessTokenPayload {
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  iss?: string;
  aud?: string;
  azp?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

export interface KeycloakUser {
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm?: string;
}
