import axiosImport = require("axios");
import type { AxiosInstance, AxiosResponse, AxiosStatic } from "axios";
import * as https from "node:https";
import * as queryString from "node:querystring";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import type { Context } from "@decaf-ts/core";
import type {
  KeycloakClientConfig,
  KeycloakClientRoleConfig,
  KeycloakEnvironment,
  KeycloakIdentityProviderConfig,
  KeycloakRealmConfig,
  KeycloakSetupConfig,
  KeycloakUser,
  KeycloakServiceOptions,
} from "./types";
import {
  createKeycloakIdentityProviderConfig,
  createKeycloakSetupConfig,
} from "./helpers";

type KeycloakRealmRepresentation = {
  realm?: string;
  enabled?: boolean;
  [key: string]: unknown;
};

type KeycloakUserRepresentation = {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
  credentials?: Array<{
    type: string;
    value: string;
    temporary?: boolean;
  }>;
  [key: string]: unknown;
};

type KeycloakRoleRepresentation = {
  id: string;
  name: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
  description?: string;
};

export class KeycloakService {
  private readonly options: KeycloakServiceOptions;
  private config?: KeycloakSetupConfig;

  constructor(options: KeycloakServiceOptions = {}) {
    this.options = options;
  }

  async initialize(): Promise<{
    config: KeycloakSetupConfig;
    client: AxiosInstance;
  }> {
    const config = this.ensureConfig();
    const client = this.createHttpClient(config);
    return { config, client };
  }
  //
  // setConfig(config: KeycloakSetupConfig): void {
  //   this.config = config;
  //   this.http = this.createHttpClient(config);
  // }

  async setupKeycloak(
    keycloakSetupConfig: KeycloakSetupConfig = this.ensureConfig(),
    ctx?: Context
  ): Promise<KeycloakSetupConfig> {
    this.config = keycloakSetupConfig;
    this.http = this.createHttpClient(keycloakSetupConfig);
    keycloakSetupConfig.adminApiUser!.usernameUUID =
      await this.createAdminApiUser(keycloakSetupConfig, ctx);
    return keycloakSetupConfig;
  }

  async addRealm(
    realmName: string,
    payload: Partial<KeycloakRealmRepresentation> = {},
    ctx?: Context
  ): Promise<void> {
    await this.createRealm(realmName, payload, ctx);
  }

  async editRealm(
    realmName: string,
    payload: Partial<KeycloakRealmRepresentation>,
    ctx?: Context
  ): Promise<void> {
    await this.updateRealm(realmName, payload, ctx);
  }

  async removeRealm(realmName: string, ctx?: Context): Promise<void> {
    await this.deleteOrganization(realmName, ctx);
  }

  async addUserToRealm(
    keycloakUser: KeycloakUser,
    payload: Partial<KeycloakUserRepresentation> = {},
    ctx?: Context
  ): Promise<string> {
    return this.createRealmUser(keycloakUser, payload, ctx);
  }

  async editUser(
    realmName: string,
    userUUID: string,
    payload: Partial<KeycloakUserRepresentation>,
    ctx?: Context
  ): Promise<void> {
    await this.updateRealmUser(realmName, userUUID, payload, ctx);
  }

  async removeUserFromRealm(
    realmName: string,
    userUUID: string,
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    await this.deleteUser(
      adminAccessToken,
      {
        realm: realmName,
        usernameUUID: userUUID,
        apiClientId: "",
        username: "",
        password: "",
      },
      ctx
    );
  }

  async addRealmRolesToUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    await this.assignRolesToUser(
      `/admin/realms/${realmName}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      roleNames,
      adminAccessToken,
      ctx,
      "Unable to add Realm Roles to User"
    );
  }

  async addClientRolesToUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    await this.assignRolesToUser(
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      roleNames,
      adminAccessToken,
      ctx,
      "Unable to add Client Roles to User"
    );
  }

  async deleteAdminApiUser(
    keycloakSetupConfig: KeycloakSetupConfig = this.ensureConfig(),
    ctx?: Context
  ): Promise<void> {
    const rootAccessToken = await this.getAccessToken(
      keycloakSetupConfig.rootApiUser!,
      ctx
    );
    await this.deleteUser(
      rootAccessToken,
      keycloakSetupConfig.adminApiUser!,
      ctx
    );
  }

  async setupOrganization(
    realmName: string,
    config?: KeycloakSetupConfig,
    ctx?: Context
  ): Promise<KeycloakSetupConfig> {
    const current =
      config ?? this.createKeycloakSetupConfigFromEnvironment(realmName);
    this.config = current;
    this.http = this.createHttpClient(current);

    await this.createRealm(
      current.realmApiUser!.realm,
      current.realmConfig ?? {},
      ctx
    );
    current.realmApiUser!.usernameUUID = await this.createRealmUser(
      current.realmApiUser!,
      {},
      ctx
    );
    await this.setRealmApiUserRoles(current.realmApiUser!, ctx);

    current.client.clientUUID = await this.createClient(current, ctx);
    await this.updateClientScopesRolesMappers(current.realmApiUser!, ctx);

    return current;
  }

  async setupOrganizationSSO(
    keycloakSetupConfig: KeycloakSetupConfig = this.ensureConfig(),
    ctx?: Context
  ): Promise<void> {
    await this.createClientRoles(keycloakSetupConfig, ctx);
    if (keycloakSetupConfig.identityProvider) {
      await this.createIdentityProvider(keycloakSetupConfig, ctx);
      await this.createIdentityProviderMappers(keycloakSetupConfig, ctx);
    }
  }

  async deleteOrganization(realmName: string, ctx?: Context): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}`,
      adminAccessToken,
      undefined,
      ctx,
      204
    );
  }

  createKeycloakSetupConfigFromEnvironment(
    realmName = this.ensureEnvironment().realm
  ): KeycloakSetupConfig {
    return createKeycloakSetupConfig(
      this.ensureEnvironment({ realm: realmName })
    );
  }

  createKeycloakIdentityProviderConfigFromEnvironment(): KeycloakIdentityProviderConfig {
    return createKeycloakIdentityProviderConfig(this.ensureEnvironment());
  }

  private ensureConfig(): KeycloakSetupConfig {
    if (this.config) return this.config;
    if (this.options.config) {
      this.config = this.options.config;
      return this.config;
    }
    if (!this.options.environment) {
      throw new InternalError(
        "KeycloakService requires either config or environment"
      );
    }
    this.config = createKeycloakSetupConfig(this.options.environment);
    return this.config;
  }

  private ensureEnvironment(
    override?: Partial<KeycloakEnvironment>
  ): KeycloakEnvironment {
    const environment = this.options.environment;
    if (!environment) {
      throw new InternalError("KeycloakService environment is not configured");
    }
    return { ...environment, ...override };
  }

  private createHttpClient(config: KeycloakSetupConfig): AxiosInstance {
    return axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isProduction(),
      }),
    });
  }

  private isProduction(): boolean {
    return this.options.environment?.env === "production";
  }

  public async getAccessToken(
    keycloakUser: KeycloakUser,
    ctx?: Context
  ): Promise<string> {
    const response = await this.request(
      "POST",
      `/realms/${keycloakUser.realm}/protocol/openid-connect/token`,
      undefined,
      queryString.stringify({
        client_id: keycloakUser.apiClientId,
        username: keycloakUser.username,
        password: keycloakUser.password,
        grant_type: "password",
      }),
      ctx,
      200,
      {
        "content-type": "application/x-www-form-urlencoded",
      }
    );

    const data = this.parseJsonResponse<{ access_token?: string }>(
      response.data
    );
    if (data?.access_token) return data.access_token;

    throw new BadRequestError(
      `Unable to get Keycloak access token for user ${keycloakUser.username}`
    );
  }

  public async createAdminApiUser(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context
  ): Promise<string> {
    const rootAccessToken = await this.getAccessToken(
      keycloakSetupConfig.rootApiUser!,
      ctx
    );
    const response = await this.request(
      "POST",
      `/admin/realms/${keycloakSetupConfig.adminApiUser?.realm}/users`,
      rootAccessToken,
      {
        username: keycloakSetupConfig.adminApiUser?.username,
        firstName: "Api",
        lastName: "Admin",
        email: `${keycloakSetupConfig.adminApiUser?.apiClientId}@${keycloakSetupConfig.adminApiUser?.realm}.com`,
        emailVerified: true,
        enabled: true,
        credentials: [
          {
            type: "password",
            value: keycloakSetupConfig.adminApiUser?.password,
            temporary: false,
          },
        ],
      },
      ctx,
      201
    );

    const adminApiUserUUID = this.extractUUIDfromResponse(response);
    await this.assignRolesToUser(
      `/admin/realms/${keycloakSetupConfig.adminApiUser?.realm}/roles`,
      `/admin/realms/${keycloakSetupConfig.adminApiUser?.realm}/users/${adminApiUserUUID}/role-mappings/realm`,
      ["admin"],
      rootAccessToken,
      ctx,
      "Unable to set Admin Api User role"
    );

    return adminApiUserUUID;
  }

  public async deleteUser(
    accessToken: string,
    keycloakUser: KeycloakUser,
    ctx?: Context
  ): Promise<void> {
    await this.request(
      "DELETE",
      `/admin/realms/${keycloakUser.realm}/users/${keycloakUser.usernameUUID}`,
      accessToken,
      undefined,
      ctx,
      204
    );
  }

  public async createRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig> = {},
    ctx?: Context
  ): Promise<void> {
    const adminAccessToken = await this.getAccessToken(
      this.ensureConfig().adminApiUser!,
      ctx
    );
    await this.request(
      "POST",
      `/admin/realms`,
      adminAccessToken,
      { realm: realmName, enabled: true, ...payload },
      ctx,
      201
    );
  }

  public async updateRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig>,
    ctx?: Context
  ): Promise<void> {
    const adminAccessToken = await this.getAccessToken(
      this.ensureConfig().adminApiUser!,
      ctx
    );
    const currentRealm = await this.getRealm(realmName, adminAccessToken, ctx);
    await this.request(
      "PUT",
      `/admin/realms/${realmName}`,
      adminAccessToken,
      { ...currentRealm, ...payload, realm: realmName },
      ctx,
      204
    );
  }

  public async createRealmUser(
    keycloakUser: KeycloakUser,
    payload: Partial<KeycloakUserRepresentation> = {},
    ctx?: Context
  ): Promise<string> {
    const adminAccessToken = await this.getAccessToken(
      this.ensureConfig().adminApiUser!,
      ctx
    );
    const response = await this.request(
      "POST",
      `/admin/realms/${keycloakUser.realm}/users`,
      adminAccessToken,
      {
        username: keycloakUser.username,
        firstName: "Api",
        lastName: "Admin",
        email: `${keycloakUser.apiClientId}@${keycloakUser.realm}.com`,
        emailVerified: true,
        enabled: true,
        credentials: [
          {
            type: "password",
            value: keycloakUser.password,
            temporary: false,
          },
        ],
        ...payload,
      },
      ctx,
      201
    );

    return this.extractUUIDfromResponse(response);
  }

  public async updateRealmUser(
    realmName: string,
    userUUID: string,
    payload: Partial<KeycloakUserRepresentation>,
    ctx?: Context
  ): Promise<void> {
    const adminAccessToken = await this.getAccessToken(
      this.ensureConfig().adminApiUser!,
      ctx
    );
    const currentUser = await this.getRealmUser(
      realmName,
      userUUID,
      adminAccessToken,
      ctx
    );
    await this.request(
      "PUT",
      `/admin/realms/${realmName}/users/${userUUID}`,
      adminAccessToken,
      { ...currentUser, ...payload },
      ctx,
      204
    );
  }

  public async setRealmApiUserRoles(
    keycloakUser: KeycloakUser,
    ctx?: Context
  ): Promise<void> {
    const adminAccessToken = await this.getAccessToken(
      this.ensureConfig().adminApiUser!,
      ctx
    );
    const realmManagementUUID = await this.getClientUUID(
      adminAccessToken,
      keycloakUser.realm,
      "realm-management",
      ctx
    );
    await this.assignRolesToUser(
      `/admin/realms/${keycloakUser.realm}/clients/${realmManagementUUID}/roles`,
      `/admin/realms/${keycloakUser.realm}/users/${keycloakUser.usernameUUID}/role-mappings/clients/${realmManagementUUID}`,
      ["manage-clients", "manage-identity-providers"],
      adminAccessToken,
      ctx,
      "Unable to set Realm Api User roles"
    );
  }

  public async createClient(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context,
    overrides: Partial<KeycloakClientConfig> = {}
  ): Promise<string> {
    const realmAccessToken = await this.getAccessToken(
      keycloakSetupConfig.realmApiUser!,
      ctx
    );
    const client = this.normalizeClientConfig(
      keycloakSetupConfig.client,
      overrides
    );
    const response = await this.request(
      "POST",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/clients`,
      realmAccessToken,
      this.buildClientPayload(client),
      ctx,
      201
    );
    return this.extractUUIDfromResponse(response);
  }

  public async updateClient(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context,
    overrides: Partial<KeycloakClientConfig> = {}
  ): Promise<void> {
    const realmAccessToken = await this.getAccessToken(
      keycloakSetupConfig.realmApiUser!,
      ctx
    );
    const client = this.normalizeClientConfig(
      keycloakSetupConfig.client,
      overrides
    );
    const clientUUID =
      client.clientUUID ??
      (await this.getClientUUID(
        realmAccessToken,
        keycloakSetupConfig.realmApiUser!.realm,
        client.clientId,
        ctx
      ));
    const response = await this.request(
      "PUT",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/clients/${encodeURIComponent(
        clientUUID
      )}`,
      realmAccessToken,
      this.buildClientPayload(client),
      ctx,
      204
    );
    if (response.status >= 300) {
      throw new InternalError(
        `Unable to update Keycloak client ${client.clientId}`
      );
    }
  }

  public async getClientUUID(
    accessToken: string,
    realmName: string,
    clientId: string,
    ctx?: Context
  ): Promise<string> {
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}/clients?clientId=${encodeURIComponent(clientId)}`,
      accessToken,
      undefined,
      ctx,
      200
    );
    const data = this.parseJsonResponse<Array<{ id?: string }>>(response.data);
    const clientUUID = data?.[0]?.id;
    if (clientUUID) return clientUUID;
    throw new NotFoundError(`Unable to get Keycloak Client UUID: ${clientId}`);
  }

  public async createClientRoles(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context,
    roleConfigs: KeycloakClientRoleConfig[] = keycloakSetupConfig.client
      .roles ?? []
  ): Promise<void> {
    const realmAccessToken = await this.getAccessToken(
      keycloakSetupConfig.realmApiUser!,
      ctx
    );
    for (const role of roleConfigs) {
      await this.request(
        "POST",
        `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/clients/${keycloakSetupConfig.client.clientUUID}/roles`,
        realmAccessToken,
        {
          name: role.roleName,
          description: role.description ?? `Auto-created role ${role.roleName}`,
          composite: false,
          clientRole: true,
        },
        ctx,
        201
      );
    }
  }

  public async createIdentityProvider(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context,
    overrides: Partial<KeycloakIdentityProviderConfig> = {}
  ): Promise<void> {
    const realmAccessToken = await this.getAccessToken(
      keycloakSetupConfig.realmApiUser!,
      ctx
    );
    const identityProvider = this.normalizeIdentityProviderConfig(
      keycloakSetupConfig.identityProvider!,
      overrides
    );
    await this.request(
      "POST",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/identity-provider/instances`,
      realmAccessToken,
      this.buildIdentityProviderPayload(identityProvider),
      ctx,
      201
    );
  }

  public async updateIdentityProvider(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context,
    overrides: Partial<KeycloakIdentityProviderConfig> = {}
  ): Promise<void> {
    const realmAccessToken = await this.getAccessToken(
      keycloakSetupConfig.realmApiUser!,
      ctx
    );
    const identityProvider = this.normalizeIdentityProviderConfig(
      keycloakSetupConfig.identityProvider!,
      overrides
    );
    const response = await this.request(
      "PUT",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/identity-provider/instances/${encodeURIComponent(
        identityProvider.alias
      )}`,
      realmAccessToken,
      this.buildIdentityProviderPayload(identityProvider),
      ctx,
      204
    );
    if (response.status >= 300) {
      throw new InternalError(
        `Unable to update identity provider ${identityProvider.alias}`
      );
    }
  }

  public async createIdentityProviderMappers(
    keycloakSetupConfig: KeycloakSetupConfig,
    ctx?: Context,
    roleConfigs: KeycloakClientRoleConfig[] = keycloakSetupConfig.client
      .roles ?? []
  ): Promise<void> {
    const realmAccessToken = await this.getAccessToken(
      keycloakSetupConfig.realmApiUser!,
      ctx
    );
    const identityProvider = keycloakSetupConfig.identityProvider!;
    for (const role of roleConfigs) {
      await this.request(
        "POST",
        `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/identity-provider/instances/${identityProvider.alias}/mappers`,
        realmAccessToken,
        {
          name: role.roleName,
          identityProviderAlias: identityProvider.alias,
          identityProviderMapper: "oidc-role-idp-mapper",
          config: {
            syncMode: identityProvider.mapperSyncMode ?? "FORCE",
            claim: identityProvider.mapperClaimName ?? "groups",
            "claim.value": role.claimValue,
            role: `${keycloakSetupConfig.client.clientId}.${role.roleName}`,
          },
        },
        ctx,
        201
      );
    }
  }

  private normalizeClientConfig(
    base: KeycloakClientConfig,
    overrides: Partial<KeycloakClientConfig>
  ): KeycloakClientConfig {
    return {
      ...base,
      ...overrides,
      redirectUris: overrides.redirectUris ?? base.redirectUris,
      webOrigins: overrides.webOrigins ?? base.webOrigins,
      roles: overrides.roles ?? base.roles,
    };
  }

  private normalizeIdentityProviderConfig(
    base: KeycloakIdentityProviderConfig,
    overrides: Partial<KeycloakIdentityProviderConfig>
  ): KeycloakIdentityProviderConfig {
    return {
      ...base,
      ...overrides,
      config: {
        ...base.config,
        ...overrides.config,
      },
    };
  }

  private buildClientPayload(
    client: KeycloakClientConfig
  ): Record<string, unknown> {
    return {
      clientId: client.clientId,
      name: client.clientName,
      description: client.description,
      rootUrl: client.rootUrl,
      adminUrl: client.adminUrl,
      baseUrl: client.baseUrl,
      surrogateAuthRequired: client.surrogateAuthRequired ?? false,
      enabled: client.enabled ?? true,
      alwaysDisplayInConsole: client.alwaysDisplayInConsole ?? false,
      clientAuthenticatorType: "client-secret",
      secret: client.secret,
      redirectUris: client.redirectUris,
      webOrigins: client.webOrigins,
      notBefore: client.notBefore ?? 0,
      bearerOnly: client.bearerOnly ?? false,
      consentRequired: client.consentRequired ?? false,
      standardFlowEnabled: client.standardFlowEnabled ?? true,
      implicitFlowEnabled: client.implicitFlowEnabled ?? false,
      directAccessGrantsEnabled: client.directAccessGrantsEnabled ?? true,
      serviceAccountsEnabled: client.serviceAccountsEnabled ?? true,
      authorizationServicesEnabled: client.authorizationServicesEnabled ?? true,
      publicClient: client.publicClient ?? false,
      frontchannelLogout: client.frontchannelLogout ?? true,
      protocol: client.protocol ?? "openid-connect",
      attributes: client.attributes ?? { "access.token.lifespan": "300" },
    };
  }

  private buildIdentityProviderPayload(
    identityProvider: KeycloakIdentityProviderConfig
  ): Record<string, unknown> {
    return {
      alias: identityProvider.alias,
      displayName: identityProvider.displayName,
      providerId: identityProvider.providerId ?? "oidc",
      enabled: identityProvider.enabled ?? true,
      updateProfileFirstLoginMode:
        identityProvider.updateProfileFirstLoginMode ?? "on",
      trustEmail: identityProvider.trustEmail ?? false,
      storeToken: identityProvider.storeToken ?? false,
      addReadTokenRoleOnCreate: false,
      authenticateByDefault: false,
      linkOnly: identityProvider.linkOnly ?? false,
      hideOnLogin: identityProvider.hideOnLogin ?? false,
      config: {
        userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
        validateSignature: true,
        tokenUrl: `https://login.microsoftonline.com/${identityProvider.tenantId}/oauth2/v2.0/token`,
        clientId: identityProvider.clientId,
        jwksUrl: `https://login.microsoftonline.com/${identityProvider.tenantId}/discovery/v2.0/keys`,
        issuer: `https://login.microsoftonline.com/${identityProvider.tenantId}/v2.0`,
        useJwksUrl: true,
        pkceEnabled: false,
        metadataDescriptorUrl: `https://login.microsoftonline.com/${identityProvider.tenantId}/v2.0/.well-known/openid-configuration`,
        authorizationUrl: `https://login.microsoftonline.com/${identityProvider.tenantId}/oauth2/v2.0/authorize`,
        clientAuthMethod: "client_secret_post",
        logoutUrl: `https://login.microsoftonline.com/${identityProvider.tenantId}/oauth2/v2.0/logout`,
        syncMode: identityProvider.syncMode ?? "LEGACY",
        clientSecret: identityProvider.clientSecret,
        ...identityProvider.config,
      },
    };
  }

  public async updateClientScopesRolesMappers(
    keycloakUser: KeycloakUser,
    ctx?: Context
  ): Promise<void> {
    const realmAccessToken = await this.getAccessToken(keycloakUser, ctx);
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${keycloakUser.realm}/client-scopes`,
      realmAccessToken,
      undefined,
      ctx,
      200
    );
    const clientScopes =
      this.parseJsonResponse<
        Array<{
          id: string;
          name: string;
          protocolMappers?: Array<{
            id: string;
            name: string;
            config: Record<string, string>;
          }>;
        }>
      >(rolesResponse.data) ?? [];
    const rolesScope = clientScopes.find((scope) => scope.name === "roles");
    const clientRolesMapper = rolesScope?.protocolMappers?.find(
      (mapper) => mapper.name === "client roles"
    );
    if (!rolesScope || !clientRolesMapper) {
      throw new NotFoundError("Unable to find client roles mapper");
    }
    clientRolesMapper.config["id.token.claim"] = "true";
    await this.request(
      "PUT",
      `/admin/realms/${keycloakUser.realm}/client-scopes/${rolesScope.id}/protocol-mappers/models/${clientRolesMapper.id}`,
      realmAccessToken,
      clientRolesMapper,
      ctx,
      204
    );
  }

  public async getRealm(
    realmName: string,
    accessToken: string,
    ctx?: Context
  ): Promise<KeycloakRealmRepresentation> {
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}`,
      accessToken,
      undefined,
      ctx,
      200
    );
    return (
      this.parseJsonResponse<KeycloakRealmRepresentation>(response.data) ?? {}
    );
  }

  public async getRealmUser(
    realmName: string,
    userUUID: string,
    accessToken: string,
    ctx?: Context
  ): Promise<KeycloakUserRepresentation> {
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}`,
      accessToken,
      undefined,
      ctx,
      200
    );
    return (
      this.parseJsonResponse<KeycloakUserRepresentation>(response.data) ?? {}
    );
  }

  public async assignRolesToUser(
    rolesUrl: string,
    setRolesUrl: string,
    roleNames: string[],
    accessToken: string,
    ctx?: Context,
    errorMsg = "Unable to assign roles to user"
  ): Promise<void> {
    const rolesResponse = await this.request(
      "GET",
      rolesUrl,
      accessToken,
      undefined,
      ctx,
      200
    );
    const responseData =
      this.parseJsonResponse<KeycloakRoleRepresentation[]>(
        rolesResponse.data
      ) ?? [];
    const selectedRoles = responseData.filter((role) =>
      roleNames.includes(role.name)
    );
    for (const role of selectedRoles) {
      await this.request("POST", setRolesUrl, accessToken, [role], ctx, 204);
    }
    if (selectedRoles.length === 0) {
      throw new NotFoundError(
        `${errorMsg}: no roles matched ${roleNames.join(", ")}`
      );
    }
  }

  public async grantRealmRolesToUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    await this.assignRolesToUser(
      `/admin/realms/${realmName}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      roleNames,
      adminAccessToken,
      ctx,
      "Unable to grant realm roles"
    );
  }

  public async revokeRealmRolesFromUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/roles`,
      adminAccessToken,
      undefined,
      ctx,
      200
    );
    const roles =
      this.parseJsonResponse<KeycloakRoleRepresentation[]>(
        rolesResponse.data
      ) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      adminAccessToken,
      selectedRoles,
      ctx,
      204
    );
  }

  public async replaceRealmRolesForUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    const currentRolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      adminAccessToken,
      undefined,
      ctx,
      200
    );
    const currentRoles =
      this.parseJsonResponse<KeycloakRoleRepresentation[]>(
        currentRolesResponse.data
      ) ?? [];
    if (currentRoles.length > 0) {
      await this.request(
        "DELETE",
        `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
        adminAccessToken,
        currentRoles,
        ctx,
        204
      );
    }
    await this.grantRealmRolesToUser(realmName, userUUID, roleNames, ctx);
  }

  public async grantClientRolesToUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    await this.assignRolesToUser(
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      roleNames,
      adminAccessToken,
      ctx,
      "Unable to grant client roles"
    );
  }

  public async revokeClientRolesFromUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      adminAccessToken,
      undefined,
      ctx,
      200
    );
    const roles =
      this.parseJsonResponse<KeycloakRoleRepresentation[]>(
        rolesResponse.data
      ) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      adminAccessToken,
      selectedRoles,
      ctx,
      204
    );
  }

  public async replaceClientRolesForUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ctx?: Context
  ): Promise<void> {
    const config = this.ensureConfig();
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ctx
    );
    const currentRolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      adminAccessToken,
      undefined,
      ctx,
      200
    );
    const currentRoles =
      this.parseJsonResponse<KeycloakRoleRepresentation[]>(
        currentRolesResponse.data
      ) ?? [];
    if (currentRoles.length > 0) {
      await this.request(
        "DELETE",
        `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
        adminAccessToken,
        currentRoles,
        ctx,
        204
      );
    }
    await this.grantClientRolesToUser(
      realmName,
      clientUUID,
      userUUID,
      roleNames,
      ctx
    );
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    accessToken?: string,
    payload?: unknown,
    ctx?: Context,
    successCode = 200,
    headers: Record<string, string> = {}
  ): Promise<AxiosResponse> {
    const config = this.ensureConfig();
    const response = await axios.request({
      method,
      url: `${config.protocol}://${config.host}${path}`,
      data:
        payload === undefined
          ? undefined
          : typeof payload === "string"
            ? payload
            : JSON.stringify(payload),
      headers: {
        ...headers,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(payload !== undefined && typeof payload !== "string"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: this.isProduction() }),
      validateStatus: () => true,
    });
    this.handleHttpResponse(response, successCode, ctx);
    return response;
  }

  private handleHttpResponse(
    response: AxiosResponse,
    successCode: number,
    _ctx?: Context,
    errorMsg?: string
  ): void {
    const message = errorMsg
      ? `${errorMsg}: ${response.statusText}.`
      : response.statusText;
    if (response.status === 409) throw new ConflictError(message);
    if (response.status !== successCode) throw new InternalError(message);
  }

  private extractUUIDfromResponse(response: AxiosResponse): string {
    const location = response.headers.location as string | undefined;
    if (!location) {
      throw new InternalError(
        "Keycloak response did not include a location header"
      );
    }
    return location.split("/").pop() ?? "";
  }

  private parseJsonResponse<T>(data: unknown): T | undefined {
    if (typeof data === "string") {
      try {
        return JSON.parse(data) as T;
      } catch {
        return undefined;
      }
    }
    return data as T;
  }
}
const axios = axiosImport as unknown as AxiosStatic;
