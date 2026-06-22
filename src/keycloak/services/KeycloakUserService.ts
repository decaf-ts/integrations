import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type { KeycloakSetupConfig, KeycloakUser } from "../types";
import type { AxiosInstance } from "axios";
import * as https from "node:https";

export type KeycloakUserRepresentation = {
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

export class KeycloakUserService extends ClientBasedService<
  AxiosInstance,
  KeycloakSetupConfig
> {
  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: KeycloakSetupConfig; client: AxiosInstance }> {
    const { ctx } = await this.logCtx(args, this.initialize, true);
    this._config = this.config;
    const client = this.createHttpClient(ctx);
    return { config: this.config, client };
  }

  async addUserToRealm(...args: MaybeContextualArg<any>): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.addUserToRealm,
      false
    );
    const keycloakUser = ctxArgs[0] as KeycloakUser;
    const payload =
      (ctxArgs[0]?.[1] as Partial<KeycloakUserRepresentation>) ?? {};
    return this.createRealmUser(keycloakUser, payload, ...ctxArgs);
  }

  async editUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.editUser, false);
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const payload = ctxArgs[0]?.[2] as Partial<KeycloakUserRepresentation>;
    await this.updateRealmUser(realmName, userUUID, payload, ...ctxArgs);
  }

  async updateRealmUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.updateRealmUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const payload = ctxArgs[0]?.[2] as Partial<KeycloakUserRepresentation>;
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}`,
      adminAccessToken,
      undefined,
      ...ctxArgs,
      200
    );
    const currentUser =
      this.parseJsonResponse<KeycloakUserRepresentation>(response.data) ?? {};
    await this.request(
      "PUT",
      `/admin/realms/${realmName}/users/${userUUID}`,
      adminAccessToken,
      { ...currentUser, ...payload },
      ...ctxArgs,
      204
    );
  }

  async removeUserFromRealm(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.removeUserFromRealm,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const config = this.config;
    const adminAccessToken = await this.getAccessToken(
      config.adminApiUser!,
      ...ctxArgs
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
      ...ctxArgs
    );
  }

  async deleteUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.deleteUser, false);
    const accessToken = ctxArgs[0] as string;
    const keycloakUser = ctxArgs[0]?.[1] as KeycloakUser;
    await this.request(
      "DELETE",
      `/admin/realms/${keycloakUser.realm}/users/${keycloakUser.usernameUUID}`,
      accessToken,
      undefined,
      ...ctxArgs,
      204
    );
  }

  async createRealmUser(...args: MaybeContextualArg<any>): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.createRealmUser,
      false
    );
    const keycloakUser = ctxArgs[0] as KeycloakUser;
    const payload =
      (ctxArgs[0]?.[1] as Partial<KeycloakUserRepresentation>) ?? {};
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const userPayload = {
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
    };
    const response = await this.request(
      "POST",
      `/admin/realms/${keycloakUser.realm}/users`,
      adminAccessToken,
      userPayload,
      ...ctxArgs,
      201
    );
    return this.extractUUIDfromResponse(response);
  }

  async assignRolesToUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.assignRolesToUser,
      false
    );
    const rolesUrl = ctxArgs[0] as string;
    const setRolesUrl = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[];
    const accessToken = ctxArgs[0]?.[3] as string;
    const response = await this.request(
      "GET",
      rolesUrl,
      accessToken,
      undefined,
      ...ctxArgs,
      200
    );
    const roles = this.parseJsonResponse<any[]>(response.data) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    if (selectedRoles.length === 0) {
      throw new NotFoundError(`No roles matched ${roleNames.join(", ")}`);
    }
    const promises: Promise<void>[] = selectedRoles.map((role) =>
      this.request("POST", setRolesUrl, accessToken, [role], ...ctxArgs, 204)
    );
    await Promise.all(promises);
  }

  async grantRealmRolesToUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.grantRealmRolesToUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[];
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    await this.assignRolesToUser(
      ...ctxArgs,
      `/admin/realms/${realmName}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      roleNames,
      adminAccessToken
    );
  }

  async grantClientRolesToUser(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.grantClientRolesToUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const clientUUID = ctxArgs[0]?.[1] as string;
    const userUUID = ctxArgs[0]?.[2] as string;
    const roleNames = ctxArgs[0]?.[3] as string[];
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    await this.assignRolesToUser(
      ...ctxArgs,
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      roleNames,
      adminAccessToken
    );
  }

  async revokeRealmRolesFromUser(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.revokeRealmRolesFromUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[];
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/roles`,
      adminAccessToken,
      undefined,
      ...ctxArgs,
      200
    );
    const roles = this.parseJsonResponse<any[]>(rolesResponse.data) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      adminAccessToken,
      selectedRoles,
      ...ctxArgs,
      204
    );
  }

  async replaceRealmRolesForUser(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.replaceRealmRolesForUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const userUUID = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[];
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const currentRolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
      adminAccessToken,
      undefined,
      ...ctxArgs,
      200
    );
    const currentRoles =
      this.parseJsonResponse<any[]>(currentRolesResponse.data) ?? [];
    if (currentRoles.length > 0) {
      await this.request(
        "DELETE",
        `/admin/realms/${realmName}/users/${userUUID}/role-mappings/realm`,
        adminAccessToken,
        currentRoles,
        ...ctxArgs,
        204
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
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.revokeClientRolesFromUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const clientUUID = ctxArgs[0]?.[1] as string;
    const userUUID = ctxArgs[0]?.[2] as string;
    const roleNames = ctxArgs[0]?.[3] as string[];
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const rolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/clients/${clientUUID}/roles`,
      adminAccessToken,
      undefined,
      ...ctxArgs,
      200
    );
    const roles = this.parseJsonResponse<any[]>(rolesResponse.data) ?? [];
    const selectedRoles = roles.filter((role) => roleNames.includes(role.name));
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      adminAccessToken,
      selectedRoles,
      ...ctxArgs,
      204
    );
  }

  async replaceClientRolesForUser(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.replaceClientRolesForUser,
      false
    );
    const realmName = ctxArgs[0] as string;
    const clientUUID = ctxArgs[0]?.[1] as string;
    const userUUID = ctxArgs[0]?.[2] as string;
    const roleNames = ctxArgs[0]?.[3] as string[];
    const adminAccessToken = await this.getAdminAccessToken(...ctxArgs);
    const currentRolesResponse = await this.request(
      "GET",
      `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
      adminAccessToken,
      undefined,
      ...ctxArgs,
      200
    );
    const currentRoles =
      this.parseJsonResponse<any[]>(currentRolesResponse.data) ?? [];
    if (currentRoles.length > 0) {
      await this.request(
        "DELETE",
        `/admin/realms/${realmName}/users/${userUUID}/role-mappings/clients/${clientUUID}`,
        adminAccessToken,
        currentRoles,
        ...ctxArgs,
        204
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
    const config = this.config;
    return this.getAccessToken(config.adminApiUser!, ...args);
  }

  private async getAccessToken(...args: ContextualArgs<any>): Promise<string> {
    const keycloakUser = args[0] as KeycloakUser;
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
      ...args,
      200,
      { "content-type": "application/x-www-form-urlencoded" }
    );
    const data = this.parseJsonResponse<{ access_token?: string }>(
      response.data
    );
    if (data?.access_token) return data.access_token;
    throw new BadRequestError(
      `Unable to get Keycloak access token for user ${keycloakUser.username}`
    );
  }

  private request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    accessToken?: string,
    payload?: unknown,
    ...args: ContextualArgs<any>
  ): Promise<any> {
    const successCode = (args.pop() as number) || 200;
    const headers = (args.pop() as Record<string, string>) || {};

    return this.client.request({
      method,
      url: `${this.config.protocol}://${this.config.host}${path}`,
      data: payload === undefined ? undefined : JSON.stringify(payload),
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
  }

  private handleHttpResponse(
    response: any,
    successCode: number,
    errorMsg?: string
  ): void {
    const message = errorMsg
      ? `${errorMsg}: ${response.statusText}.`
      : response.statusText;
    const operation = "Keycloak HTTP request";
    throw this.parseError(new Error(message), message, operation);
  }

  private parseError(err: Error, message: string, operation: string): Error {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new NotFoundError(message, err);
    }

    if (lowerMessage.includes("already exists") || lowerMessage.includes("conflict") || lowerMessage.includes("409")) {
      return new ConflictError(message, err);
    }

    if (lowerMessage.includes("invalid") || lowerMessage.includes("bad request") || lowerMessage.includes("400")) {
      return new BadRequestError(message, err);
    }

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
      return new NotFoundError(message, err);
    }

    if (lowerMessage.includes("forbidden") || lowerMessage.includes("403")) {
      return new NotFoundError(message, err);
    }

    return new InternalError(message, err);
  }

  private extractUUIDfromResponse(response: any): string {
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
