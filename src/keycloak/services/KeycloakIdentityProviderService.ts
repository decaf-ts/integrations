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
import type { AxiosInstance } from "axios";
import * as https from "node:https";

export class KeycloakIdentityProviderService extends ClientBasedService<
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

  async createIdentityProvider(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.createIdentityProvider,
      false
    );
    const keycloakSetupConfig = ctxArgs[0] as KeycloakSetupConfig;
    const overrides =
      (ctxArgs[0]?.[0] as
        | Partial<KeycloakIdentityProviderConfig>
        | undefined) ?? {};
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
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
      ...ctxArgs,
      201
    );
  }

  async updateIdentityProvider(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.updateIdentityProvider,
      false
    );
    const keycloakSetupConfig = ctxArgs[0] as KeycloakSetupConfig;
    const overrides =
      (ctxArgs[0]?.[0] as
        | Partial<KeycloakIdentityProviderConfig>
        | undefined) ?? {};
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
    );
    const identityProvider = this.normalizeIdentityProviderConfig(
      keycloakSetupConfig.identityProvider!,
      overrides
    );
    await this.request(
      "PUT",
      `/admin/realms/${keycloakSetupConfig.realmApiUser?.realm}/identity-provider/instances/${encodeURIComponent(identityProvider.alias)}`,
      realmAccessToken,
      this.buildIdentityProviderPayload(identityProvider),
      ...ctxArgs,
      204
    );
  }

  async createIdentityProviderMappers(
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.createIdentityProviderMappers,
      false
    );
    const keycloakSetupConfig = ctxArgs[0] as KeycloakSetupConfig;
    const roleConfigs =
      (ctxArgs[0]?.[0] as any[] | undefined) ??
      keycloakSetupConfig.client.roles ??
      [];
    const realmAccessToken = await this.getRealmAccessToken(
      keycloakSetupConfig,
      ...ctxArgs
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
        ...ctxArgs,
        201
      );
    }
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

  private async getRealmAccessToken(
    ...args: ContextualArgs<any>
  ): Promise<string> {
    const config = args[0] as KeycloakSetupConfig;
    return this.getAccessToken(config.realmApiUser!, ...args);
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
