import { metadata } from "@decaf-ts/decoration";

export const AUTH_NAMESPACE_KEY = "auth-namespace";

/**
 * Marks a model as namespace-scoped for auth handlers.
 *
 * This decorator mirrors the role metadata pattern, but stores namespace scopes
 * that downstream auth handlers compare against the authenticated principal.
 */
export function namespace(namespaces: string[]) {
  return metadata(AUTH_NAMESPACE_KEY, namespaces);
}
