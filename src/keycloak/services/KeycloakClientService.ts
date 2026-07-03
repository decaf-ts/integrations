import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type {
  KeycloakClientConfig,
  KeycloakClientRoleConfig,
  KeycloakSetupConfig,
  KeycloakUser,
} from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { resolveKeycloakIsProduction } from "./runtime";

export class KeycloakClientService extends ClientBasedService<
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

  async createClient(
    keycloakSetupConfig: KeycloakSetupConfig,
    overrides: Partial<KeycloakClientConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { ctxArgs } = (
      await this.logCtx(args, "createClient", true)
    ).for(this.createClient);
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    const client = this.normalizeClientConfig(
      keycloakSetupConfig.client,
      overrides ?? {}
    );
    const response = await this.request(
      "POST",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/clients`,
      realmAccessToken,
      this.buildClientPayload(client),
      201,
      {},
      ...ctxArgs
    );
    return this.extractUUIDfromResponse(response);
  }

  async updateClient(
    keycloakSetupConfig: KeycloakSetupConfig,
    overrides: Partial<KeycloakClientConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateClient", true)
    ).for(this.updateClient);
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    const client = this.normalizeClientConfig(
      keycloakSetupConfig.client,
      overrides ?? {}
    );
    const clientUUID =
      client.clientUUID ??
      (await this.getClientUUID(
        realmAccessToken,
        keycloakSetupConfig.realmApiUser!.realm,
        client.clientId,
        ...ctxArgs
      ));
    await this.request(
      "PUT",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/clients/${encodeURIComponent(clientUUID)}`,
      realmAccessToken,
      this.buildClientPayload(client),
      204,
      {},
      ...ctxArgs
    );
  }

  async getClientUUID(
    accessToken: string,
    realmName: string,
    clientId: string,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { ctxArgs } = (
      await this.logCtx(args, "getClientUUID", true)
    ).for(this.getClientUUID);
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}/clients?clientId=${encodeURIComponent(clientId)}`,
      accessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    const data = this.parseJsonResponse<Array<{ id?: string }>>(response.data);
    const clientUUID = data?.[0]?.id;
    if (clientUUID) return clientUUID;
    throw new NotFoundError(`Unable to get Keycloak Client UUID: ${clientId}`);
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

  private createHttpClient(config: KeycloakSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: (resolveKeycloakIsProduction(this.config as any)),
      }),
    });
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
        rejectUnauthorized: (resolveKeycloakIsProduction(this.config as any)),
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
    const message = errorMsg
      ? `${errorMsg}: Expected ${successCode}, received ${response.status}: ${response.statusText}.`
      : `Expected ${successCode}, received ${response.status}: ${response.statusText}`;
    const status = response.status as number;
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
