/**
 * @module integrations/nest/types
 * @summary Nest integration types.
 * @description Shared request-context and auth payload types for Nest integration helpers.
 */
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

export interface AuthRequestLike {
  path?: string;
  method?: string;
  headers?: Record<string, unknown>;
  [key: symbol | string]: unknown;
}

export interface AuthExecutionContextLike {
  switchToHttp(): { getRequest<T extends AuthRequestLike = AuthRequestLike>(): T };
  getHandler?(): { name?: string };
}

export interface AuthHandlerLike {
  authorize(context: AuthExecutionContextLike, resource?: string): Promise<void>;
}
