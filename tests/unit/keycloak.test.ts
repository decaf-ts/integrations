import {
  createKeycloakClientRoleConfigFromEnvironment,
  createKeycloakClientConfig,
  createKeycloakIdentityProviderConfig,
  createKeycloakSetupConfig,
  splitList,
} from "../../src/keycloak";

describe("keycloak helpers", () => {
  it("splits lists safely", () => {
    expect(splitList("a,b, c")).toEqual(["a", "b", "c"]);
  });

  it("builds keycloak configs from environment", () => {
    const environment = {
      host: "keycloak.example.com",
      protocol: "https" as const,
      realm: "demo",
      adminRealm: "master",
      adminApiClientId: "admin-cli",
      rootUsername: "root",
      rootPassword: "root-password",
      adminApiUsername: "admin",
      adminApiPassword: "admin-password",
      realmApiClientId: "realm-cli",
      realmApiUsername: "realm-admin",
      realmApiPassword: "realm-password",
      clientId: "demo-client",
      clientSecret: "secret",
      clientName: "Demo Client",
      clientDescription: "Demo",
      clientRedirectUris: "https://example.com/callback,https://example.com/alt",
      clientWebOrigins: "https://example.com",
      clientRoles: "reader:reader:Read access,writer:writer:Write access",
      clientRolesSeparator: ",",
      clientRoleSeparator: ":",
      defaultSeparator: ",",
      identityProviderAlias: "entra",
      identityProviderDisplayName: "Entra",
      identityProviderTenantId: "tenant",
      identityProviderClientId: "client-id",
      identityProviderClientSecret: "client-secret",
    };

    expect(createKeycloakClientRoleConfigFromEnvironment(environment)).toHaveLength(2);
    expect(createKeycloakClientConfig(environment).redirectUris).toHaveLength(2);
    expect(createKeycloakIdentityProviderConfig(environment).mapperClaimName).toBe("groups");
    expect(createKeycloakSetupConfig(environment).client.clientId).toBe("demo-client");
    expect(createKeycloakSetupConfig(environment).realmConfig?.enabled).toBe(true);
  });
});
