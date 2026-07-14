import { service } from "@decaf-ts/core";
import { JwtService } from "@decaf-ts/crypto/integration/services/jwt";

/**
 * Builds an unsigned JWT with the given payload.
 * Used to simulate Keycloak-issued tokens in e2e tests without a running Keycloak instance.
 */
export function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

export interface TokenUser {
  email?: string;
  preferred_username: string;
  roles: string[];
  audience?: string;
  azp?: string;
  realm?: string;
}

/**
 * Builds a Keycloak-style JWT for a test user.
 */
export function buildUserToken(user: TokenUser): string {
  const realm = user.realm ?? "test-realm";
  const payload: Record<string, unknown> = {
    iss: `https://auth.example.com/realms/${realm}`,
    preferred_username: user.preferred_username,
    aud: user.audience ?? "decaf-test-client",
    realm_access: { roles: user.roles },
    resource_access: {},
  };
  if (user.email) payload.email = user.email;
  if (user.azp) payload.azp = user.azp;
  return buildJwt(payload);
}

/** Admin user with the "admin" role. */
export const ADMIN_USER = {
  email: "admin@example.com",
  preferred_username: "admin",
  roles: ["admin"],
} satisfies TokenUser;

export const ADMIN_TOKEN = buildUserToken(ADMIN_USER);

/** Partner user with the "partner" role. */
export const PARTNER_USER = {
  email: "partner@example.com",
  preferred_username: "partner",
  roles: ["partner"],
} satisfies TokenUser;

export const PARTNER_TOKEN = buildUserToken(PARTNER_USER);

/** User with no roles. */
export const NOROLE_USER = {
  email: "nobody@example.com",
  preferred_username: "nobody",
  roles: [],
} satisfies TokenUser;

export const NOROLE_TOKEN = buildUserToken(NOROLE_USER);

@service("jwt")
export class TestJwtService extends JwtService {
  override async initialize(...args: Parameters<JwtService["initialize"]>) {
    return super.initialize((args[0] ?? {}) as Parameters<
      JwtService["initialize"]
    >[0]);
  }
}
