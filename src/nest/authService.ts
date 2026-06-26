/**
 * @module integrations/nest/authService
 * @summary Nest-compatible authentication service helpers.
 * @description Request-context-aware auth helpers for Nest applications using Decaf integration patterns.
 *
 * Supports two modes:
 * - **Verify mode** (default when `verifyUrl` is set): validates the JWT signature
 *   against the Keycloak JWKS endpoint using `jose.jwtVerify`.
 * - **Decode-only mode** (when `verifyToken` is false / `verifyUrl` is empty):
 *   decodes the JWT without signature verification (dev/local mode).
 */
import { AuthorizationError } from "@decaf-ts/core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  extractKeycloakRoles,
  getRealmFromIssuer,
  getTokenPayload,
  getUser,
  getClientRoles,
} from "./utils";
import type { KeycloakAccessTokenPayload, KeycloakUser } from "./types";

/**
 * Configuration for the {@link AuthService}.
 */
export interface AuthServiceOptions {
  /**
   * Whether to verify the JWT signature against the Keycloak JWKS endpoint.
   * When `false` (or `verifyUrl` is empty), tokens are decoded without
   * signature verification (dev/local mode only).
   * @default false
   */
  verifyToken?: boolean;
  /**
   * The Keycloak JWKS URL (e.g. `https://keycloak/realms/myrealm/protocol/openid-connect/certs`).
   * Required when `verifyToken` is `true`.
   */
  verifyUrl?: string;
  /**
   * Clock tolerance for JWT expiry verification (in seconds).
   * @default 5
   */
  clockToleranceSeconds?: number;
  /**
   * Keycloak client IDs to exclude when extracting roles from `resource_access`.
   * @default ["account"]
   */
  excludedClients?: string[];
}

export class AuthService {
  private readonly verifyToken: boolean;
  private readonly verifyUrl: string;
  private readonly clockToleranceSeconds: number;
  private readonly excludedClients: string[];
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(options: AuthServiceOptions = {}) {
    this.verifyToken = !!options.verifyToken && !!options.verifyUrl;
    this.verifyUrl = options.verifyUrl ?? "";
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 5;
    this.excludedClients = options.excludedClients ?? ["account"];
  }

  getTokenPayload(jwt: string): KeycloakAccessTokenPayload | null {
    return getTokenPayload(jwt);
  }

  getRoles(jwt: string): string[] {
    return this.extractKeycloakRoles(this.getTokenPayload(jwt));
  }

  getUser(jwt: string): KeycloakUser | undefined {
    return getUser(jwt);
  }

  extractKeycloakRoles(payload: KeycloakAccessTokenPayload | null): string[] {
    return extractKeycloakRoles(payload);
  }

  /**
   * Extracts client roles from the `resource_access` claim, excluding
   * the configured `excludedClients` (default: `["account"]`).
   */
  extractClientRoles(
    payload: KeycloakAccessTokenPayload | null
  ): string[] {
    return getClientRoles(payload, this.excludedClients);
  }

  getRealmFromIssuer(jwt: string): string {
    return getRealmFromIssuer(jwt);
  }

  /**
   * Validates a JWT:
   * - In **verify mode**: verifies the signature against the Keycloak JWKS
   *   endpoint using `jose.jwtVerify`, then returns the verified payload.
   * - In **decode-only mode**: decodes the JWT without verification and
   *   returns the payload (or throws if unparseable).
   *
   * @throws {AuthorizationError} when the token is invalid, expired, or
   *   signature verification fails.
   */
  async assertValidToken(
    jwt: string
  ): Promise<KeycloakAccessTokenPayload> {
    if (this.verifyToken) {
      return this.verifyAgainstJwks(jwt);
    }
    const payload = this.getTokenPayload(jwt);
    if (!payload) {
      throw new AuthorizationError("Invalid token");
    }
    return payload;
  }

  /**
   * Verifies the JWT signature against the Keycloak JWKS endpoint.
   * Lazily creates the JWKS keystore on first call.
   */
  private async verifyAgainstJwks(
    jwt: string
  ): Promise<KeycloakAccessTokenPayload> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(this.verifyUrl));
    }
    try {
      const { payload } = await jwtVerify(jwt, this.jwks, {
        clockTolerance: `${this.clockToleranceSeconds}s`,
      });
      return payload as unknown as KeycloakAccessTokenPayload;
    } catch (e: any) {
      throw new AuthorizationError("Invalid token: " + (e?.message ?? e));
    }
  }
}
