import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type {
  KeycloakIdentityProviderConfig,
  KeycloakSetupConfig,
  KeycloakUser,
} from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";

export class KeycloakIdentityProviderService extends ClientBasedService<
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

  async createIdentityProvider(
    keycloakSetupConfig: KeycloakSetupConfig,
    overrides: Partial<KeycloakIdentityProviderConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createIdentityProvider", true)
    ).for(this.createIdentityProvider);
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    const identityProvider = this.normalizeIdentityProviderConfig(
      keycloakSetupConfig.identityProvider!,
      overrides ?? {}
    );
    await this.request(
      "POST",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/identity-provider/instances`,
      realmAccessToken,
      this.buildIdentityProviderPayload(identityProvider),
      201,
      {},
      ...ctxArgs
    );
  }

  async updateIdentityProvider(
    keycloakSetupConfig: KeycloakSetupConfig,
    overrides: Partial<KeycloakIdentityProviderConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateIdentityProvider", true)
    ).for(this.updateIdentityProvider);
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    const identityProvider = this.normalizeIdentityProviderConfig(
      keycloakSetupConfig.identityProvider!,
      overrides ?? {}
    );
    await this.request(
      "PUT",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/identity-provider/instances/${encodeURIComponent(identityProvider.alias)}`,
      realmAccessToken,
      this.buildIdentityProviderPayload(identityProvider),
      204,
      {},
      ...ctxArgs
    );
  }

  async createIdentityProviderMappers(
    keycloakSetupConfig: KeycloakSetupConfig,
    roleConfigs: any[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createIdentityProviderMappers", true)
    ).for(this.createIdentityProviderMappers);
    const roles = roleConfigs ?? keycloakSetupConfig.client.roles ?? [];
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    const identityProvider = keycloakSetupConfig.identityProvider!;
    for (const role of roles) {
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
        rejectUnauthorized: ((this.config as any).isProduction()),
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
        rejectUnauthorized: ((this.config as any).isProduction()),
      }),
      validateStatus: () => true,
    });
    if (response.status !== successCode) {
      this.handleHttpResponse(response, successCode);
    }
    return response;
  }

  private handleHttpResponse(response: any, successCode: number): void {
    const status = response.status as number;
    const message = `Expected ${successCode}, received ${response.status}: ${response.statusText}`;
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
