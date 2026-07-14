/**
 * @module integrations/nest/utils
 * @summary Nest integration utilities.
 * @description Helper functions used by the Nest auth and request-context adapters.
 */
import type { KeycloakAccessTokenPayload } from "./types";
import { AuthorizationError } from "@decaf-ts/core";

export const DECAF_ADAPTER_OPTIONS = Symbol("DecafAdapterForOptions");

export function extractKeycloakRoles(payload: KeycloakAccessTokenPayload | null): string[] {
  const roles = new Set<string>();
  if (Array.isArray(payload?.realm_access?.roles)) {
    for (const role of payload.realm_access.roles) {
      if (!role?.startsWith("namespace:")) roles.add(role);
    }
  }
  if (payload?.resource_access && typeof payload.resource_access === "object") {
    for (const client of Object.keys(payload.resource_access)) {
      for (const role of payload.resource_access[client]?.roles ?? []) {
        if (!role?.startsWith("namespace:")) roles.add(role);
      }
    }
  }
  return [...roles];
}

export function extractKeycloakNamespaces(
  payload: KeycloakAccessTokenPayload | null | undefined
): string[] {
  const namespaces = new Set<string>();
  const rawNamespaces = payload?.namespaces ?? payload?.namespace;
  if (Array.isArray(rawNamespaces)) {
    for (const namespace of rawNamespaces) {
      if (namespace) namespaces.add(namespace);
    }
  } else if (typeof rawNamespaces === "string" && rawNamespaces) {
    namespaces.add(rawNamespaces);
  }

  const rawRoles = [
    ...(Array.isArray(payload?.realm_access?.roles)
      ? payload.realm_access.roles
      : []),
    ...(payload?.resource_access && typeof payload.resource_access === "object"
      ? Object.values(payload.resource_access).flatMap(
          (client) => client?.roles ?? []
        )
      : []),
  ];
  for (const role of rawRoles) {
    if (role?.startsWith("namespace:")) {
      namespaces.add(role.slice("namespace:".length));
    }
  }

  return [...namespaces];
}

export function getRealmFromIssuer(jwt: string): string {
  const payload = decodeJwtPayload<{ iss?: string }>(jwt);
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

function decodeJwtPayload<T>(jwt: string): T | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * Extracts roles from the `resource_access` claim only, optionally excluding
 * specified client IDs (e.g. `"account"`).  Unlike {@link extractKeycloakRoles}
 * this does NOT include `realm_access.roles`.
 *
 * @param payload   The decoded JWT payload.
 * @param excluded  Client IDs to skip.  @default ["account"]
 */
export function getClientRoles(
  payload: KeycloakAccessTokenPayload | null,
  excluded: string[] = ["account"]
): string[] {
  const resourceAccess = payload?.resource_access;
  if (!resourceAccess || typeof resourceAccess !== "object") return [];
  const roles = new Set<string>();
  for (const [clientId, data] of Object.entries(resourceAccess)) {
    if (excluded.includes(clientId)) continue;
    if (Array.isArray(data?.roles)) {
      for (const role of data.roles) roles.add(role);
    }
  }
  return [...roles];
}
