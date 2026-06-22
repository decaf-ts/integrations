import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { Context, ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type {
  KeycloakRealmConfig,
  KeycloakSetupConfig,
  KeycloakUser,
} from "../types";
import type { AxiosInstance } from "axios";
import * as https from "node:https";

type KeycloakRealmRepresentation = {
  realm?: string;
  enabled?: boolean;
  [key: string]: unknown;
};

export class KeycloakRealmService extends ClientBasedService<
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

  async createRealm(
    realmName: string,
    payload?: Partial<KeycloakRealmConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createRealm, false);
    const adminAccessToken = await this.getAccessToken(
      this.config.adminApiUser!,
      ...ctxArgs
    );
    await this.request(
      "POST",
      `/admin/realms`,
      adminAccessToken,
      { realm: realmName, enabled: true, ...payload },
      ...ctxArgs,
      201
    );
  }

  async updateRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateRealm, false);
    const adminAccessToken = await this.getAccessToken(
      this.config.adminApiUser!,
      ...ctxArgs
    );
    const currentRealm = await this.fetchRealm(
      realmName,
      adminAccessToken,
      ...ctxArgs
    );
    await this.request(
      "PUT",
      `/admin/realms/${realmName}`,
      adminAccessToken,
      { ...currentRealm, ...payload, realm: realmName },
      ...ctxArgs,
      204
    );
  }

  async deleteRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.deleteRealm, false);
    const adminAccessToken = await this.getAccessToken(
      this.config.adminApiUser!,
      ...ctxArgs
    );
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}`,
      adminAccessToken,
      undefined,
      ...ctxArgs,
      204
    );
  }

  async addRealm(
    realmName: string,
    payload?: any,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.addRealm, false);
    await this.createRealm(realmName, payload, ...ctxArgs);
  }

  async editRealm(
    realmName: string,
    payload: any,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.editRealm, false);
    await this.updateRealm(realmName, payload, ...ctxArgs);
  }

  async removeRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.removeRealm, false);
    await this.deleteRealm(realmName, ...ctxArgs);
  }

  async getRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<KeycloakRealmRepresentation> {
    const { log, ctxArgs } = await this.logCtx(args, this.getRealm, false);
    const adminAccessToken = await this.getAccessToken(
      this.config.adminApiUser!,
      ...ctxArgs
    );
    return this.fetchRealm(realmName, adminAccessToken, ...ctxArgs);
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

  private async getAccessToken(
    keycloakUser: KeycloakUser,
    ...args: ContextualArgs<any>
  ): Promise<string> {
    const client = this.client;
    const response = await client.request({
      method: "POST",
      url: `${this.config.protocol}://${this.config.host}/realms/${keycloakUser.realm}/protocol/openid-connect/token`,
      data: new URLSearchParams({
        client_id: keycloakUser.apiClientId,
        username: keycloakUser.username,
        password: keycloakUser.password,
        grant_type: "password",
      }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    const data = this.parseJsonResponse<{ access_token?: string }>(
      response.data
    );
    if (data?.access_token) return data.access_token;
    throw new BadRequestError(
      `Unable to get Keycloak access token for user ${keycloakUser.username}`
    );
  }

  private async fetchRealm(
    realmName: string,
    accessToken: string,
    ...args: ContextualArgs<any>
  ): Promise<KeycloakRealmRepresentation> {
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}`,
      accessToken,
      undefined,
      ...args,
      200
    );
    return (
      this.parseJsonResponse<KeycloakRealmRepresentation>(response.data) ?? {}
    );
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    accessToken?: string,
    payload?: unknown,
    ...args: ContextualArgs<any>
  ): Promise<any> {
    const successCode = (args.pop() as number) || 200;
    const headers = (args.pop() as Record<string, string>) || {};

    const response = await this.client.request({
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
    this.handleHttpResponse(response, successCode);
    return response;
  }

  private handleHttpResponse(response: any, successCode: number): void {
    const message = response.statusText;
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
