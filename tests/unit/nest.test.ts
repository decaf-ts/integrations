import {
  AuthService,
  getRealmFromIssuer,
  getTokenPayload,
  getUser,
  KeycloakAuthHandler,
} from "../../src/nest";
import type { AuthExecutionContextLike } from "../../src/nest/types";
import { AuthorizationError, Context } from "@decaf-ts/core";
import type { AuthRequestLike } from "@decaf-ts/for-http/server";

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
  realm_access: { roles: ["reader"] },
  resource_access: { app: { roles: ["writer"] } },
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
  it("extracts payload and roles", () => {
    const jwt = buildJwt(VALID_PAYLOAD);

    expect(getTokenPayload(jwt)?.email).toBe("user@example.com");
    expect(new AuthService().getRoles(jwt)).toEqual(["reader", "writer"]);
    expect(getRealmFromIssuer(jwt)).toBe("demo");
    expect(getUser(jwt)?.realm).toBe("demo");
  });

  describe("KeycloakAuthHandler", () => {
    let handler: KeycloakAuthHandler;

    beforeEach(() => {
      handler = new KeycloakAuthHandler();
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
  });
});
