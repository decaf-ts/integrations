import {
  namespace,
  extractKeycloakRoles,
  extractKeycloakNamespaces,
  KeycloakAuthHandler,
  KeycloakNamespaceAuthHandler,
} from "../../src/nest";
import { getRealmFromIssuer } from "../../src/nest/utils";
import { JwtService } from "@decaf-ts/crypto/integration/services/jwt";
import type { AuthExecutionContextLike } from "../../src/nest/types";
import { AuthorizationError, Context } from "@decaf-ts/core";
import type { AuthRequestLike } from "@decaf-ts/for-http/server";
import { model, Model } from "@decaf-ts/decorator-validation";
import { TestJwtService } from "../e2e/fakes/jwt";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

const VALID_PAYLOAD = {
  iss: "https://auth.example.com/realms/demo",
  email: "user@example.com",
  preferred_username: "user",
  aud: "my-client",
  namespaces: ["tenant:alpha"],
  realm_access: { roles: ["reader"] },
  resource_access: { app: { roles: ["writer", "namespace:tenant:beta"] } },
};

function buildContext(
  request: Partial<AuthRequestLike>
): AuthExecutionContextLike {
  return {
    switchToHttp: () => ({ getRequest: () => request as AuthRequestLike }),
  };
}

function buildAuthContext(): Context & {
  store: Record<string, unknown>;
} {
  const store: Record<string, unknown> = {};
  const ctx = new Context();
  (ctx as any).accumulate = (value: Record<string, unknown>) => {
    Object.assign(store, value);
    return ctx;
  };
  return Object.assign(ctx, { store }) as Context & {
    store: Record<string, unknown>;
  };
}

describe("nest auth helpers", () => {
  const jwtService = new JwtService();

  it("extracts payload and roles", () => {
    const jwt = buildJwt(VALID_PAYLOAD);

    expect(jwtService.getTokenPayload(jwt)?.email).toBe("user@example.com");
    expect(extractKeycloakRoles(jwtService.getTokenPayload(jwt))).toEqual([
      "reader",
      "writer",
    ]);
    expect(extractKeycloakNamespaces(jwtService.getTokenPayload(jwt))).toEqual([
      "tenant:alpha",
      "tenant:beta",
    ]);
    expect(getRealmFromIssuer(jwt)).toBe("demo");
    expect(jwtService.getUser(jwt)?.email).toBe("user@example.com");
  });

  describe("KeycloakAuthHandler", () => {
    let handler: KeycloakAuthHandler;

    beforeEach(async () => {
      handler = new KeycloakNamespaceAuthHandler() as KeycloakAuthHandler;
      (handler as any).jwtService = new TestJwtService();
      await (handler as any).jwtService.boot({});
    });

    it("authorizes a valid token and accumulates auth data onto context", async () => {
      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: `Bearer ${buildJwt(VALID_PAYLOAD)}` },
      };
      const ctx = buildAuthContext();

      await handler.authorize(buildContext(request), "Product", undefined, ctx);

      expect(ctx.store["user"]).toBe("user@example.com");
      expect(ctx.store["organization"]).toBe("my-client");
      expect(ctx.store["roles"]).toEqual(["reader", "writer"]);
      expect(ctx.store["namespaces"]).toEqual(["tenant:alpha", "tenant:beta"]);
    });

    it("throws AuthorizationError when token is missing", async () => {
      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: {},
      };

      await expect(
        handler.authorize(buildContext(request), "Product", undefined, new Context())
      ).rejects.toThrow(AuthorizationError);
    });

    it("skips public routes without requiring a token", async () => {
      const request: Partial<AuthRequestLike> = {
        path: "/public/health",
        method: "GET",
        headers: {},
      };

      await expect(
        handler.authorize(buildContext(request), "Product", undefined, new Context())
      ).resolves.toBeUndefined();
    });

    it("enforces requiredRoles against JWT roles", async () => {
      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: `Bearer ${buildJwt(VALID_PAYLOAD)}` },
      };

      await expect(
        handler.authorize(
          buildContext(request),
          "Product",
          ["admin"],
          new Context()
        )
      ).rejects.toThrow(/Missing required roles: admin/);
    });

    it("passes when requiredRoles are satisfied", async () => {
      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: `Bearer ${buildJwt(VALID_PAYLOAD)}` },
      };

      await expect(
        handler.authorize(
          buildContext(request),
          "Product",
          ["reader"],
          new Context()
        )
      ).resolves.toBeUndefined();
    });

    it("falls back to realm from issuer when aud/azp are absent", async () => {
      const jwt = buildJwt({
        ...VALID_PAYLOAD,
        aud: undefined,
        azp: undefined,
      });
      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: `Bearer ${jwt}` },
      };
      const ctx = buildAuthContext();

      await handler.authorize(buildContext(request), "Product", undefined, ctx);

      expect(ctx.store["organization"]).toBe("demo");
    });

    it("validate rejects invalid tokens", async () => {
      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: "Bearer not-a-jwt" },
      };

      await expect(
        handler.authorize(buildContext(request), "Product", undefined, new Context())
      ).rejects.toThrow(AuthorizationError);
    });

    it("enforces namespace metadata from the namespace decorator", async () => {
      @namespace(["tenant:alpha"])
      @model()
      class NamespaceProduct extends Model {}

      const request: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: `Bearer ${buildJwt(VALID_PAYLOAD)}` },
      };

      await expect(
        handler.authorize(
          buildContext(request),
          NamespaceProduct,
          undefined,
          new Context()
        )
      ).resolves.toBeUndefined();

      const deniedToken = buildJwt({
        ...VALID_PAYLOAD,
        namespaces: ["tenant:alpha"],
        resource_access: { app: { roles: ["writer"] } },
      });
      const deniedRequest: Partial<AuthRequestLike> = {
        path: "/products",
        method: "GET",
        headers: { authorization: `Bearer ${deniedToken}` },
      };

      @namespace(["tenant:beta"])
      @model()
      class NamespaceProductDenied extends Model {}

      await expect(
        handler.authorize(
          buildContext(deniedRequest),
          NamespaceProductDenied,
          undefined,
          new Context()
        )
      ).rejects.toThrow(/Missing required namespaces: tenant:beta/);
    });
  });
});
