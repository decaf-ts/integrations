import { NotFoundError } from "@decaf-ts/db-decorators";
import {
  ClientBasedService,
  Context,
  ContextualArgs,
  MaybeContextualArg,
  PersistenceKeys,
  service,
} from "@decaf-ts/core";
import type { KeycloakSetupConfig, KeycloakUser } from "../types";
import type { AxiosInstance } from "axios";
import * as https from "node:https";

import { KeycloakRealmService } from "./KeycloakRealmService";
import { KeycloakUserService } from "./KeycloakUserService";
import { KeycloakRoleService } from "./KeycloakRoleService";
import { KeycloakClientService } from "./KeycloakClientService";
import { KeycloakIdentityProviderService } from "./KeycloakIdentityProviderService";
import { KeycloakAuthService } from "./KeycloakAuthService";

export class KeycloakService extends ClientBasedService<
  AxiosInstance,
  KeycloakSetupConfig
> {
  protected realmService!: KeycloakRealmService;

  protected userService!: KeycloakUserService;

  protected roleService!: KeycloakRoleService;

  protected clientService!: KeycloakClientService;

  protected identityProviderService!: KeycloakIdentityProviderService;

  protected authService!: KeycloakAuthService;

  constructor() {
    super();
  }

  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: KeycloakSetupConfig; client: AxiosInstance }> {
    const { log, ctxArgs } = await this.logCtx(args, this.initialize, true);
    this._config = this.config;
    const config = ctxArgs[0] as KeycloakSetupConfig;

    log.debug(`Binding inner services...`);
    service()(KeycloakRealmService);
    service()(KeycloakUserService);
    service()(KeycloakRoleService);
    service()(KeycloakClientService);
    service()(KeycloakIdentityProviderService);
    service()(KeycloakAuthService);

    log.debug(`Initializing inner services...`);
    this.realmService = new KeycloakRealmService();
    await this.realmService.initialize(config);
    this.userService = new KeycloakUserService();
    await this.userService.initialize(config);
    this.roleService = new KeycloakRoleService();
    await this.roleService.initialize(config);
    this.clientService = new KeycloakClientService();
    await this.clientService.initialize(config);
    this.identityProviderService = new KeycloakIdentityProviderService();
    await this.identityProviderService.initialize(config);
    this.authService = new KeycloakAuthService();
    await this.authService.initialize(config);

    const client = this.createHttpClient(config);
    log.debug(
      `Keycloak Service initialized with config: ${JSON.stringify(this.config)}`
    );
    return { config: this.config, client };
  }

  async setupKeycloak(
    ...args: MaybeContextualArg<any>
  ): Promise<KeycloakSetupConfig> {
    const { log, ctxArgs } = await this.logCtx(args, this.setupKeycloak, false);
    const keycloakSetupConfig = ctxArgs[0] as KeycloakSetupConfig;

    const adminApiUserUUID = await this.userService.addUserToRealm(
      keycloakSetupConfig.adminApiUser!,
      {},
      ...ctxArgs
    );
    keycloakSetupConfig.adminApiUser!.usernameUUID = adminApiUserUUID;
    const client = this.createHttpClient(keycloakSetupConfig);
    await this.roleService.grantRealmRolesToUser(
      keycloakSetupConfig.adminApiUser!.realm,
      adminApiUserUUID,
      ["admin"],
      ...ctxArgs
    );
    return keycloakSetupConfig;
  }

  async addRealm(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.addRealm, false);
    const realmName = ctxArgs[0] as string;
    const payload =
      ctxArgs[0]?.[1] && typeof ctxArgs[0]?.[1] === "object"
        ? ctxArgs[0]?.[1]
        : {};

    await this.realmService.addRealm(realmName, payload, ...ctxArgs);
  }

  async editRealm(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.editRealm, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1];

    await this.realmService.editRealm(realmName, payload, ...ctxArgs);
  }

  async removeRealm(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.removeRealm, false);
    const realmName = ctxArgs[0] as string;

    await this.realmService.removeRealm(realmName, ...ctxArgs);
  }

  async addUserToRealm(...args: MaybeContextualArg<any>): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.addUserToRealm,
      false
    );
    const keycloakUser = ctxArgs[0] as KeycloakUser;
    const payload =
      ctxArgs[0]?.[1] && typeof ctxArgs[0]?.[1] === "object"
        ? ctxArgs[0]?.[1]
        : {};

    return this.userService.addUserToRealm(keycloakUser, payload, ...ctxArgs);
  }

  async editUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.editUser, false);
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const payload = ctxArgs[0]?.[2];

    await this.userService.editUser(realmName, userUUID, payload, ...ctxArgs);
  }

  async removeUserFromRealm(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.removeUserFromRealm,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;

    await this.userService.removeUserFromRealm(realmName, userUUID, ...ctxArgs);
  }

  async addRealmRolesToUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.addRealmRolesToUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[];

    await this.roleService.grantRealmRolesToUser(
      realmName,
      userUUID,
      roleNames,
      ...ctxArgs
    );
  }

  async addClientRolesToUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.addClientRolesToUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const clientUUID = ctxArgs[0]?.[1] as string;
    const userUUID = ctxArgs[0]?.[2] as string;
    const roleNames = ctxArgs[0]?.[3] as string[];

    await this.roleService.grantClientRolesToUser(
      realmName,
      clientUUID,
      userUUID,
      roleNames,
      ...ctxArgs
    );
  }

  async deleteAdminApiUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.deleteAdminApiUser,
      false
    );
    const keycloakSetupConfig = ctxArgs[0] as KeycloakSetupConfig;

    const client = this.createHttpClient(keycloakSetupConfig);
    const rootAccessToken = await this.authService.getAccessToken(
      keycloakSetupConfig.rootApiUser!,
      ...ctxArgs
    );
    await this.userService.deleteUser(
      rootAccessToken,
      keycloakSetupConfig.adminApiUser!,
      ...ctxArgs
    );
  }

  async setupOrganization(
    ...args: MaybeContextualArg<any>
  ): Promise<KeycloakSetupConfig> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.setupOrganization,
      false
    );
    const realmName = ctxArgs[0] as string;
    const config = ctxArgs[0]?.[1] as KeycloakSetupConfig;

    const adminAccessToken = await this.authService.getAccessToken(
      config.adminApiUser!,
      ...ctxArgs
    );

    await this.realmService.createRealm(
      config.realmApiUser!.realm,
      config.realmConfig ?? {},
      ...ctxArgs
    );

    const realmUserUUID = await this.userService.createRealmUser(
      config.realmApiUser!,
      {},
      ...ctxArgs
    );
    config.realmApiUser!.usernameUUID = realmUserUUID;

    const realmManagementUUID = await this.clientService.getClientUUID(
      adminAccessToken,
      config.realmApiUser!.realm,
      "realm-management",
      ...ctxArgs
    );
    await this.roleService.assignRolesToUser(
      `/admin/realms/${config.realmApiUser!.realm}/clients/${realmManagementUUID}/roles`,
      `/admin/realms/${config.realmApiUser!.realm}/users/${realmUserUUID}/role-mappings/clients/${realmManagementUUID}`,
      ["manage-clients", "manage-identity-providers"],
      adminAccessToken,
      ...ctxArgs
    );

    const clientUUID = await this.clientService.createClient(
      config,
      ...ctxArgs
    );
    config.client.clientUUID = clientUUID;

    await this.updateClientScopesRolesMappers(config.realmApiUser!, ...ctxArgs);

    return config;
  }

  async setupOrganizationSSO(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.setupOrganizationSSO,
      false
    );
    const keycloakSetupConfig = ctxArgs[0] as KeycloakSetupConfig;

    await this.clientService.createClientRoles(keycloakSetupConfig, ...ctxArgs);
    if (keycloakSetupConfig.identityProvider) {
      await this.identityProviderService.createIdentityProvider(
        keycloakSetupConfig,
        ...ctxArgs
      );
      await this.identityProviderService.createIdentityProviderMappers(
        keycloakSetupConfig,
        ...ctxArgs
      );
    }
  }

  async deleteOrganization(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.deleteOrganization,
      false
    );
    const realmName = ctxArgs[0] as string;

    await this.realmService.removeRealm(realmName, ...ctxArgs);
  }

  private createHttpClient(config: KeycloakSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !["development", "local"].includes(config.id),
      }),
    });
  }

  private async updateClientScopesRolesMappers(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.updateClientScopesRolesMappers,
      false
    );
    const keycloakUser = ctxArgs[0] as KeycloakUser;

    const client = this.createHttpClient(this.config);
    const realmAccessToken = await this.authService.getAccessToken(
      keycloakUser,
      ...ctxArgs
    );
    const rolesResponse = await client.request({
      method: "GET",
      url: `${this.config.protocol}://${this.config.host}/admin/realms/${keycloakUser.realm}/client-scopes`,
      headers: {
        Authorization: `Bearer ${realmAccessToken}`,
      },
      validateStatus: () => true,
    });
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
    await client.request({
      method: "PUT",
      url: `${this.config.protocol}://${this.config.host}/admin/realms/${keycloakUser.realm}/client-scopes/${rolesScope.id}/protocol-mappers/models/${clientRolesMapper.id}`,
      data: JSON.stringify(clientRolesMapper),
      headers: {
        Authorization: `Bearer ${realmAccessToken}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    });
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
