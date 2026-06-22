import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type {
  KeycloakClientRoleConfig,
  KeycloakSetupConfig,
  KeycloakUser,
} from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";

export class KeycloakRoleService extends ClientBasedService<
  AxiosInstance,
  KeycloakSetupConfig
> {
  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: KeycloakSetupConfig; client: AxiosInstance }> {
    const { ctxArgs } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config = ctxArgs[0] as KeycloakSetupConfig;
    this._config = config;
    const client = this.createHttpClient(config);
    this._client = client;
    return { config, client };
  }

  async createClientRoles(
    keycloakSetupConfig: KeycloakSetupConfig,
    roleConfigs: KeycloakClientRoleConfig[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createClientRoles", true)
    ).for(this.createClientRoles);
    const roles = roleConfigs ?? keycloakSetupConfig.client.roles ?? [];
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    for (const role of roles) {
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
        201,
        {},
        ...ctxArgs
      );
    }
  }

  async getRealmRoles(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<any[]> {
    const { ctxArgs } = (
      await this.logCtx(args, "getRealmRoles", true)
    ).for(this.getRealmRoles);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}/roles`,
      adminAccessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    return this.parseJsonResponse<any[]>(response.data) ?? [];
  }

  async getClientRoles(
    realmName: string,
    clientUUID: string,
    ...args: MaybeContextualArg<any>
  ): Promise<any[]> {
    const { ctxArgs } = (
      await this.logCtx(args, "getClientRoles", true)
    ).for(this.getClientRoles);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      adminAccessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    return this.parseJsonResponse<any[]>(response.data) ?? [];
  }

  async grantRealmRolesToUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "grantRealmRolesToUser", true)
    ).for(this.grantRealmRolesToUser);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    await this.assignRolesToUser(
      `/admin/realms/${realmName}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      roleNames,
      adminAccessToken,
      ...ctxArgs
    );
  }

  async grantClientRolesToUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "grantClientRolesToUser", true)
    ).for(this.grantClientRolesToUser);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    await this.assignRolesToUser(
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      roleNames,
      adminAccessToken,
      ...ctxArgs
    );
  }

  async revokeRealmRolesFromUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "revokeRealmRolesFromUser", true)
    ).for(this.revokeRealmRolesFromUser);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/roles`,
      adminAccessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    const roles = this.parseJsonResponse<any[]>(rolesResponse.data) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      adminAccessToken,
      selectedRoles,
      204,
      {},
      ...ctxArgs
    );
  }

  async replaceRealmRolesForUser(
    realmName: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "replaceRealmRolesForUser", true)
    ).for(this.replaceRealmRolesForUser);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const currentRolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      adminAccessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    const currentRoles =
      this.parseJsonResponse<any[]>(currentRolesResponse.data) ?? [];
    if (currentRoles.length > 0) {
      await this.request(
        "DELETE",
        `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
        adminAccessToken,
        currentRoles,
        204,
        {},
        ...ctxArgs
      );
    }
    await this.grantRealmRolesToUser(
      realmName,
      userUUID,
      roleNames,
      ...ctxArgs
    );
  }

  async revokeClientRolesFromUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "revokeClientRolesFromUser", true)
    ).for(this.revokeClientRolesFromUser);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      adminAccessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    const roles = this.parseJsonResponse<any[]>(rolesResponse.data) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      adminAccessToken,
      selectedRoles,
      204,
      {},
      ...ctxArgs
    );
  }

  async replaceClientRolesForUser(
    realmName: string,
    clientUUID: string,
    userUUID: string,
    roleNames: string[],
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "replaceClientRolesForUser", true)
    ).for(this.replaceClientRolesForUser);
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const currentRolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      adminAccessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    const currentRoles =
      this.parseJsonResponse<any[]>(currentRolesResponse.data) ?? [];
    if (currentRoles.length > 0) {
      await this.request(
        "DELETE",
        `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
        adminAccessToken,
        currentRoles,
        204,
        {},
        ...ctxArgs
      );
    }
    await this.grantClientRolesToUser(
      realmName,
      clientUUID,
      userUUID,
      roleNames,
      ...ctxArgs
    );
  }

  private createHttpClient(config: KeycloakSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isProduction(config),
      }),
    });
  }

  private isProduction(config: KeycloakSetupConfig): boolean {
    return config.id === "production" || config.host.includes("prod");
  }

  private async getAdminAccessToken(
    ...args: ContextualArgs<any>
  ): Promise<string> {
    const { ctxArgs } = this.logCtx(args, this.getAdminAccessToken);
    return this.getAccessToken(this.config.adminApiUser!, ...ctxArgs);
  }

  private async getRealmAccessToken(
    keycloakSetupConfig: KeycloakSetupConfig,
    ...args: ContextualArgs<any>
  ): Promise<string> {
    const { ctxArgs } = this.logCtx(args, this.getRealmAccessToken);
    return this.getAccessToken(keycloakSetupConfig.realmApiUser!, ...ctxArgs);
  }

  private async getAccessToken(
    keycloakUser: KeycloakUser,
    ...args: ContextualArgs<any>
  ): Promise<string> {
    const { ctxArgs } = this.logCtx(args, this.getAccessToken);
    const response = await this.request(
      "POST",
      `/realms/${keycloakUser.realm}/protocol/openid-connect/token`,
      undefined,
      new URLSearchParams({
        client_id: keycloakUser.apiClientId,
        username: keycloakUser.username,
        password: keycloakUser.password,
        grant_type: "password",
      }).toString(),
      200,
      { "content-type": "application/x-www-form-urlencoded" },
      ...ctxArgs
    );
    const data = this.parseJsonResponse<{ access_token?: string }>(
      response.data
    );
    if (data?.access_token) return data.access_token;
    throw new BadRequestError(
      `Unable to get Keycloak access token for user ${keycloakUser.username}`
    );
  }

  async assignRolesToUser(
    rolesUrl: string,
    setRolesUrl: string,
    roleNames: string[],
    accessToken: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "assignRolesToUser", true)
    ).for(this.assignRolesToUser);
    const response = await this.request(
      "GET",
      rolesUrl,
      accessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    const roles = this.parseJsonResponse<any[]>(response.data) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    if (selectedRoles.length === 0) {
      throw new NotFoundError(`No roles matched ${roleNames.join(", ")}`);
    }
    const promises: Promise<void>[] = selectedRoles.map((role) =>
      this.request(
        "POST",
        setRolesUrl,
        accessToken,
        [role],
        204,
        {},
        ...ctxArgs
      )
    );
    await Promise.all(promises);
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    accessToken: string | undefined,
    payload: unknown,
    successCode: number,
    headers: Record<string, string>,
    ...args: ContextualArgs<any>
  ): Promise<any> {
    this.logCtx(args, this.request);
    const response = await this.client.request({
      method,
      url: `${this.config.protocol}://${this.config.host}${path}`,
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
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isProduction(this.config),
      }),
      validateStatus: () => true,
    });
    if (response.status !== successCode) {
      this.handleHttpResponse(response, successCode);
    }
    return response;
  }

  private handleHttpResponse(
    response: any,
    successCode: number,
    errorMsg?: string
  ): void {
    const status = response.status as number;
    const message = errorMsg
      ? `${errorMsg}: Expected ${successCode}, received ${response.status}: ${response.statusText}.`
      : `Expected ${successCode}, received ${response.status}: ${response.statusText}`;
    if (status === 404 || message.toLowerCase().includes("not found")) {
      throw new NotFoundError(message);
    }
    if (status === 409 || message.toLowerCase().includes("conflict")) {
      throw new ConflictError(message);
    }
    if (status === 400) {
      throw new BadRequestError(message);
    }
    if (status === 401 || status === 403) {
      throw new NotFoundError(message);
    }
    throw new InternalError(message);
  }

  protected parseError(error: Error): Error {
    const message = error.message || error.name || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new NotFoundError(message);
    }

    if (lowerMessage.includes("already exists") || lowerMessage.includes("conflict") || lowerMessage.includes("409")) {
      return new ConflictError(message);
    }

    if (lowerMessage.includes("invalid") || lowerMessage.includes("bad request") || lowerMessage.includes("400")) {
      return new BadRequestError(message);
    }

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
      return new NotFoundError(message);
    }

    if (lowerMessage.includes("forbidden") || lowerMessage.includes("403")) {
      return new NotFoundError(message);
    }

    return new InternalError(message);
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
