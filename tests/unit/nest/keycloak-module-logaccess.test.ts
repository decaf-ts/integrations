import { KeycloakModule } from "../../../src/nest/keycloakModule";

describe("KeycloakModule logAccess wiring", () => {
  it("create({ logAccess: true }) sets logAccess on the auth handler", () => {
    const module = KeycloakModule.create({ logAccess: true });
    expect(module.authHandler.logAccess).toBe(true);
  });

  it("create() without options leaves logAccess at the handler default (false)", () => {
    const module = KeycloakModule.create();
    expect(module.authHandler.logAccess).toBe(false);
  });

  it("create({ logAccess: false }) explicitly leaves logAccess false", () => {
    const module = KeycloakModule.create({ logAccess: false });
    expect(module.authHandler.logAccess).toBe(false);
  });
});
