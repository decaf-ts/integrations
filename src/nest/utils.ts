/**
 * @module integrations/nest/utils
 * @summary Nest integration utilities.
 * @description Helper functions used by the Nest auth and request-context adapters.
 */
import type { KeycloakAccessTokenPayload, KeycloakUser } from "./types";
import { AuthorizationError } from "@decaf-ts/core";

export const DECAF_ADAPTER_OPTIONS = Symbol("DecafAdapterForOptions");

export function getTokenPayload(jwt: string): KeycloakAccessTokenPayload | null {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as KeycloakAccessTokenPayload;
  } catch {
    return null;
  }
}

export function extractKeycloakRoles(payload: KeycloakAccessTokenPayload | null): string[] {
  const roles = new Set<string>();
  if (Array.isArray(payload?.realm_access?.roles)) {
    for (const role of payload.realm_access.roles) roles.add(role);
  }
  if (payload?.resource_access && typeof payload.resource_access === "object") {
    for (const client of Object.keys(payload.resource_access)) {
      for (const role of payload.resource_access[client]?.roles ?? []) {
        roles.add(role);
      }
    }
  }
  return [...roles];
}

export function getUser(jwt: string): KeycloakUser | undefined {
  const payload = getTokenPayload(jwt);
  if (!payload) return undefined;
  return {
    preferred_username: payload.preferred_username,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
    given_name: payload.given_name,
    family_name: payload.family_name,
    realm: getRealmFromIssuer(jwt),
  };
}

export function getRealmFromIssuer(jwt: string): string {
  const payload = getTokenPayload(jwt);
  const iss = payload?.iss;
  if (!iss) {
    throw new AuthorizationError("Issuer (iss) is missing");
  }
  let url: URL;
  try {
    url = new URL(iss);
  } catch {
    throw new AuthorizationError(`Invalid issuer URL: ${iss}`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const realmsIndex = parts.indexOf("realms");
  if (realmsIndex === -1 || !parts[realmsIndex + 1]) {
    throw new AuthorizationError(`Cannot extract realm from issuer: ${iss}`);
  }
  return parts[realmsIndex + 1];
}
