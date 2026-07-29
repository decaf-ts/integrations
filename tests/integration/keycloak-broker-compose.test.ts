import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

describe("DECAF-43 broker compose harness", () => {
  it("contains the complete broker topology and does not modify the reference stack", () => {
    const composePath = path.resolve(
      process.cwd(),
      "docker/keycloak-broker-compose.yml"
    );
    const compose = fs.readFileSync(composePath, "utf8");
    expect(compose).toContain("main-keycloak:");
    expect(compose).toContain("external-keycloak:");
    expect(compose).toContain("traefik:");
    expect(compose).toContain("protected-service:");
    expect(compose).toContain("oauth2-proxy:");
    expect(compose).toContain("auth.localhost");
    expect(compose).toContain("external-auth.localhost");
    expect(compose).toContain("protected.localhost");
  });
});
