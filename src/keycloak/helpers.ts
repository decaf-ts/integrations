import type {
  KeycloakClientConfig,
  KeycloakClientRoleConfig,
  KeycloakEnvironment,
  KeycloakIdentityProviderConfig,
  KeycloakRealmConfig,
  KeycloakSetupConfig,
  KeycloakUser,
} from "./types";

export function splitList(value: string | undefined, separator = ","): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createKeycloakClientRoleConfigFromEnvironment(
  environment: Pick<
    KeycloakEnvironment,
    "clientRoles" | "clientRolesSeparator" | "clientRoleSeparator"
  >
): KeycloakClientRoleConfig[] {
  const roles = splitList(
    environment.clientRoles,
    environment.clientRolesSeparator ?? ","
  );

  const result: KeycloakClientRoleConfig[] = [];
  for (const role of roles) {
    const [roleName, claimValue, ...descriptionParts] = role.split(
      environment.clientRoleSeparator ?? ":"
    );
    if (!roleName || !claimValue) continue;
    result.push({
      roleName,
      claimValue,
      description: descriptionParts.join(environment.clientRoleSeparator ?? ":") || undefined,
    });
  }
  return result;
}

export function createKeycloakClientConfig(
  environment: KeycloakEnvironment
): KeycloakClientConfig {
  const separator = environment.defaultSeparator ?? ",";
  return {
    clientId: environment.clientId,
    secret: environment.clientSecret,
    clientName: environment.clientName,
    description: environment.clientDescription,
    rootUrl: environment.clientRootUrl,
    adminUrl: environment.clientAdminUrl,
    baseUrl: environment.clientBaseUrl,
    redirectUris: splitList(environment.clientRedirectUris, separator),
    webOrigins: splitList(environment.clientWebOrigins, separator),
    roles: createKeycloakClientRoleConfigFromEnvironment(environment),
    enabled: true,
    protocol: "openid-connect",
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: true,
    authorizationServicesEnabled: true,
    publicClient: false,
    frontchannelLogout: true,
    consentRequired: false,
    alwaysDisplayInConsole: false,
    bearerOnly: false,
    surrogateAuthRequired: false,
    notBefore: 0,
    attributes: {
      "access.token.lifespan": "300",
    },
  };
}

export function createKeycloakIdentityProviderConfig(
  environment: KeycloakEnvironment
): KeycloakIdentityProviderConfig {
  return {
    alias: environment.identityProviderAlias,
    displayName: environment.identityProviderDisplayName,
    tenantId: environment.identityProviderTenantId,
    clientId: environment.identityProviderClientId,
    clientSecret: environment.identityProviderClientSecret,
    providerId: environment.identityProviderProviderId ?? "oidc",
    syncMode: environment.identityProviderSyncMode,
    mapperSyncMode: environment.identityProviderMapperSyncMode,
    mapperClaimName: environment.identityProviderMapperClaimName ?? "groups",
    enabled: true,
    hideOnLogin: false,
    linkOnly: false,
    storeToken: false,
    trustEmail: false,
    updateProfileFirstLoginMode: "on",
    config: {
      userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    },
  };
}

export function createKeycloakRealmConfig(
  environment: KeycloakEnvironment
): KeycloakRealmConfig {
  return {
    realm: environment.realm,
    enabled: true,
    displayName: environment.realm,
    displayNameHtml: undefined,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    registrationAllowed: false,
    rememberMe: true,
    verifyEmail: true,
    attributes: {},
  };
}

export function createKeycloakSetupConfig(
  environment: KeycloakEnvironment
): KeycloakSetupConfig {
  return {
    id: environment.realm,
    host: environment.host,
    protocol: environment.protocol ?? "https",
    rootApiUser: {
      realm: environment.adminRealm,
      apiClientId: environment.adminApiClientId,
      username: environment.rootUsername,
      password: environment.rootPassword,
    } satisfies KeycloakUser,
    adminApiUser: {
      realm: environment.adminRealm,
      apiClientId: environment.adminApiClientId,
      username: environment.adminApiUsername,
      password: environment.adminApiPassword,
    } satisfies KeycloakUser,
    realmApiUser: {
      realm: environment.realm,
      apiClientId: environment.realmApiClientId,
      username: environment.realmApiUsername,
      password: environment.realmApiPassword,
    } satisfies KeycloakUser,
    client: createKeycloakClientConfig(environment),
    identityProvider: createKeycloakIdentityProviderConfig(environment),
    realmConfig: createKeycloakRealmConfig(environment),
  };
}
