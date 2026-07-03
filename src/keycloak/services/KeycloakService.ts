import { description } from "@decaf-ts/decoration";
import {
  ClientBasedService,
  ContextualArgs,
  MaybeContextualArg,
  service,
} from "@decaf-ts/core";
import { InternalError, NotFoundError } from "@decaf-ts/db-decorators";
import type { KeycloakSetupConfig, KeycloakUser } from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";

import { KeycloakRealmService } from "./KeycloakRealmService";
import { KeycloakUserService } from "./KeycloakUserService";
import { KeycloakRoleService } from "./KeycloakRoleService";
import { KeycloakClientService } from "./KeycloakClientService";
import { KeycloakIdentityProviderService } from "./KeycloakIdentityProviderService";
import { KeycloakAuthService } from "./KeycloakAuthService";

type KeycloakRuntimeSetupConfig = KeycloakSetupConfig & {
  isProduction(): boolean;
};

@description(
  "Orchestrates Keycloak realm/user/client provisioning across the inner Keycloak services"
)
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

  protected isProduction(): boolean {
    return !["development", "local"].includes(process.env["NODE_ENV"] ?? "");
  }

  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: KeycloakSetupConfig; client: AxiosInstance }> {
    const { log, ctxArgs } = (await this.logCtx(args, "initialize", true)).for(
      this.initialize
    );
    const config = ctxArgs[0] as KeycloakSetupConfig;
    const runtimeConfig: KeycloakRuntimeSetupConfig = {
      ...config,
      isProduction: this.isProduction.bind(this),
    };
    this._config = runtimeConfig;

    log.debug(`Binding inner services...`);
    service()(KeycloakRealmService);
    service()(KeycloakUserService);
    service()(KeycloakRoleService);
    service()(KeycloakClientService);
    service()(KeycloakIdentityProviderService);
    service()(KeycloakAuthService);

    log.debug(`Initializing inner services...`);
    this.realmService = new KeycloakRealmService();
    await this.realmService.initialize(runtimeConfig, ...ctxArgs);
    this.userService = new KeycloakUserService();
    await this.userService.initialize(runtimeConfig, ...ctxArgs);
    this.roleService = new KeycloakRoleService();
    await this.roleService.initialize(runtimeConfig, ...ctxArgs);
    this.clientService = new KeycloakClientService();
    await this.clientService.initialize(runtimeConfig, ...ctxArgs);
    this.identityProviderService = new KeycloakIdentityProviderService();
    await this.identityProviderService.initialize(runtimeConfig, ...ctxArgs);
    this.authService = new KeycloakAuthService();
    await this.authService.initialize(runtimeConfig, ...ctxArgs);

    const client = this.createHttpClient(runtimeConfig);
    this._client = client;
    log.debug(
      `Keycloak Service initialized with config: ${JSON.stringify(config)}`
    );
    return { config, client };
  }

  async setupKeycloak(
    keycloakSetupConfig: KeycloakSetupConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<KeycloakSetupConfig> {
    const { ctxArgs } = (await this.logCtx(args, "setupKeycloak", true)).for(
      this.setupKeycloak
    );

    const adminApiUserUUID = await this.userService.addUserToRealm(
      keycloakSetupConfig.adminApiUser!,
      {},
      ...ctxArgs
    );
    keycloakSetupConfig.adminApiUser!.usernameUUID = adminApiUserUUID;
    await this.roleService.grantRealmRolesToUser(
      keycloakSetupConfig.adminApiUser!.realm,
      adminApiUserUUID,
      ["admin"],
      ...ctxArgs
    );
    return keycloakSetupConfig;
  }

  async addRealm(
    realmName: string,
    payload: any,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "addRealm", true)).for(
      this.addRealm
    );
    await this.realmService.addRealm(realmName, payload, ...ctxArgs);
  }

  async editRealm(
    realmName: string,
    payload: any,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "editRealm", true)).for(
      this.editRealm
    );
    await this.realmService.editRealm(realmName, payload, ...ctxArgs);
  }

  async removeRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "removeRealm", true)).for(
      this.removeRealm
    );
    await this.realmService.removeRealm(realmName, ...ctxArgs);
  }

  async addUserToRealm(
    keycloakUser: KeycloakUser,
    payload: any,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { ctxArgs } = (await this.logCtx(args, "addUserToRealm", true)).for(
      this.addUserToRealm
    );
    return this.userService.addUserToRealm(keycloakUser, payload, ...ctxArgs);
  }

  async editUser(
    realmName: string,
    userUUID: string,
    payload: any,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "editUser", true)).for(
      this.editUser
    );
    await this.userService.editUser(realmName, userUUID, payload, ...ctxArgs);
  }

  async removeUserFromRealm(
    realmName: string,
    userUUID: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "removeUserFromRealm", true)
    ).for(this.removeUserFromRealm);
    await this.userService.removeUserFromRealm(realmName, userUUID, ...ctxArgs);
  }

  async addRealmRolesToUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "addRealmRolesToUser", true)
    ).for(this.addRealmRolesToUser);
    await this.roleService.grantRealmRolesToUser(
      realmName,
      userUUID,
      roleNames,
      ...ctxArgs
    );
  }

  /**
   * Creates a realm-level role, optionally as a composite of existing roles.
   */
  async createRealmRole(
    realmName: string,
    roleName: string,
    compositeRoles: string[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "createRealmRole", true)).for(
      this.createRealmRole
    );
    await this.roleService.createRealmRole(
      realmName,
      roleName,
      compositeRoles,
      ...ctxArgs
    );
  }

  /**
   * Creates a client in the configured realm and returns its UUID.
   */
  async createClient(
    config: KeycloakSetupConfig,
    overrides: Partial<import("../types").KeycloakClientConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { ctxArgs } = (await this.logCtx(args, "createClient", true)).for(
      this.createClient
    );
    return this.clientService.createClient(config, overrides, ...ctxArgs);
  }

  async addClientRolesToUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "addClientRolesToUser", true)
    ).for(this.addClientRolesToUser);
    await this.roleService.grantClientRolesToUser(
      realmName,
      clientUUID,
      userUUID,
      roleNames,
      ...ctxArgs
    );
  }

  async deleteAdminApiUser(
    keycloakSetupConfig: KeycloakSetupConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "deleteAdminApiUser", true)
    ).for(this.deleteAdminApiUser);
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
    config?: KeycloakSetupConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<KeycloakSetupConfig> {
    const { ctxArgs } = (
      await this.logCtx(args, "setupOrganization", true)
    ).for(this.setupOrganization);
    const effectiveConfig = config ?? this.config;

    const adminAccessToken = await this.authService.getAccessToken(
      effectiveConfig.adminApiUser || this.config.adminApiUser!,
      ...ctxArgs
    );

    await this.realmService.createRealm(
      effectiveConfig.realmApiUser!.realm,
      effectiveConfig.realmConfig ?? {},
      ...ctxArgs
    );
    await this.waitForRealm(effectiveConfig.realmApiUser!.realm, ...ctxArgs);

    const realmUserUUID = await this.userService.createRealmUser(
      effectiveConfig.realmApiUser!,
      {},
      ...ctxArgs
    );
    effectiveConfig.realmApiUser!.usernameUUID = realmUserUUID;

    const realmManagementUUID = await this.clientService.getClientUUID(
      adminAccessToken,
      effectiveConfig.realmApiUser!.realm,
      "realm-management",
      ...ctxArgs
    );
    await this.roleService.assignRolesToUser(
      `/admin/realms/${effectiveConfig.realmApiUser!.realm}/clients/${realmManagementUUID}/roles`,
      `/admin/realms/${effectiveConfig.realmApiUser!.realm}/users/${realmUserUUID}/role-mappings/clients/${realmManagementUUID}`,
      ["manage-clients", "manage-identity-providers"],
      adminAccessToken,
      ...ctxArgs
    );

    const clientUUID = await this.clientService.createClient(
      effectiveConfig,
      undefined,
      ...ctxArgs
    );
    effectiveConfig.client.clientUUID = clientUUID;

    await this.updateClientScopesRolesMappers(
      effectiveConfig.realmApiUser!,
      ...ctxArgs
    );

    return effectiveConfig;
  }

  async setupOrganizationSSO(
    keycloakSetupConfig: KeycloakSetupConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "setupOrganizationSSO", true)
    ).for(this.setupOrganizationSSO);

    await this.clientService.createClientRoles(
      keycloakSetupConfig,
      undefined,
      ...ctxArgs
    );
    if (keycloakSetupConfig.identityProvider) {
      await this.identityProviderService.createIdentityProvider(
        keycloakSetupConfig,
        undefined,
        ...ctxArgs
      );
      await this.identityProviderService.createIdentityProviderMappers(
        keycloakSetupConfig,
        undefined,
        ...ctxArgs
      );
    }
  }

  async deleteOrganization(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "deleteOrganization", true)
    ).for(this.deleteOrganization);
    await this.realmService.removeRealm(realmName, ...ctxArgs);
  }

  private createHttpClient(config: KeycloakSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isProduction(),
      }),
    });
  }

  private async waitForRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "waitForRealm", true)).for(
      this.waitForRealm
    );

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        await this.realmService.getRealm(realmName, ...ctxArgs);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new InternalError(`Timed out waiting for realm ${realmName}`);
  }

  private async updateClientScopesRolesMappers(
    keycloakUser: KeycloakUser,
    ...args: ContextualArgs<any>
  ): Promise<void> {
    this.logCtx(args, this.updateClientScopesRolesMappers);

    const client = this.createHttpClient(this.config);
    const realmAccessToken = await this.authService.getAccessToken(
      keycloakUser,
      ...args
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
