import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type {
  KeycloakRealmConfig,
  KeycloakSetupConfig,
  KeycloakUser,
} from "../types";
import Axios, { AxiosInstance } from "axios";
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

  async createRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createRealm", true)
    ).for(this.createRealm);
    const adminAccessToken = await this.getAccessToken(
      this.config.adminApiUser!,
      ...ctxArgs
    );
    await this.request(
      "POST",
      `/admin/realms`,
      adminAccessToken,
      { realm: realmName, enabled: true, ...payload },
      201,
      {},
      ...ctxArgs
    );
  }

  async updateRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateRealm", true)
    ).for(this.updateRealm);
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
      204,
      {},
      ...ctxArgs
    );
  }

  async deleteRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "deleteRealm", true)
    ).for(this.deleteRealm);
    const adminAccessToken = await this.getAccessToken(
      this.config.adminApiUser!,
      ...ctxArgs
    );
    await this.request(
      "DELETE",
      `/admin/realms/${realmName}`,
      adminAccessToken,
      undefined,
      204,
      {},
      ...ctxArgs
    );
  }

  async addRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "addRealm", true)
    ).for(this.addRealm);
    await this.createRealm(realmName, payload, ...ctxArgs);
  }

  async editRealm(
    realmName: string,
    payload: Partial<KeycloakRealmConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "editRealm", true)
    ).for(this.editRealm);
    await this.updateRealm(realmName, payload, ...ctxArgs);
  }

  async removeRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "removeRealm", true)
    ).for(this.removeRealm);
    await this.deleteRealm(realmName, ...ctxArgs);
  }

  async getRealm(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<KeycloakRealmRepresentation> {
    const { ctxArgs } = (
      await this.logCtx(args, "getRealm", true)
    ).for(this.getRealm);
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
    this.logCtx(args, this.getAccessToken);
    const response = await this.client.request({
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
    const { ctxArgs } = this.logCtx(args, this.fetchRealm);
    const response = await this.request(
      "GET",
      `/admin/realms/${realmName}`,
      accessToken,
      undefined,
      200,
      {},
      ...ctxArgs
    );
    return (
      this.parseJsonResponse<KeycloakRealmRepresentation>(response.data) ?? {}
    );
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
