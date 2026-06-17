import {
  DECAF_ADAPTER_OPTIONS,
  AuthService,
  getRealmFromIssuer,
  getTokenPayload,
  getUser,
} from "../../src/nest";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("nest auth helpers", () => {
  it("extracts payload and roles", () => {
    const jwt = buildJwt({
      iss: "https://auth.example.com/realms/demo",
      email: "user@example.com",
      preferred_username: "user",
      realm_access: { roles: ["reader"] },
      resource_access: { app: { roles: ["writer"] } },
    });

    expect(getTokenPayload(jwt)?.email).toBe("user@example.com");
    expect(new AuthService().getRoles(jwt)).toEqual(["reader", "writer"]);
    expect(getRealmFromIssuer(jwt)).toBe("demo");
    expect(getUser(jwt)?.realm).toBe("demo");
    expect(DECAF_ADAPTER_OPTIONS).toBeDefined();
  });
});
