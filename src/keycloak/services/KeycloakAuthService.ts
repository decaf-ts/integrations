import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type { KeycloakSetupConfig, KeycloakUser } from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { resolveKeycloakIsProduction } from "./runtime";

export class KeycloakAuthService extends ClientBasedService<
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

  async getAccessToken(
    keycloakUser: KeycloakUser,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { ctxArgs } = (
      await this.logCtx(args, "getAccessToken", true)
    ).for(this.getAccessToken);

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

  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { ctxArgs } = (
      await this.logCtx(args, "refreshAccessToken", true)
    ).for(this.refreshAccessToken);

    const response = await this.request(
      "POST",
      `/realms/${this.config.realmApiUser!.realm}/protocol/openid-connect/token`,
      undefined,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      200,
      { "content-type": "application/x-www-form-urlencoded" },
      ...ctxArgs
    );

    const data = this.parseJsonResponse<{ access_token?: string }>(
      response.data
    );
    if (data?.access_token) return data.access_token;

    throw new BadRequestError("Unable to refresh Keycloak access token");
  }

  async validateAccessToken(
    accessToken: string,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { ctxArgs } = (
      await this.logCtx(args, "validateAccessToken", true)
    ).for(this.validateAccessToken);

    try {
      await this.request(
        "GET",
        `/realms/${this.config.realmApiUser!.realm}/protocol/openid-connect/userinfo`,
        accessToken,
        undefined,
        200,
        {},
        ...ctxArgs
      );
      return true;
    } catch {
      return false;
    }
  }

  async logout(
    keycloakUser: KeycloakUser,
    refreshToken: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "logout", true)
    ).for(this.logout);

    await this.request(
      "POST",
      `/realms/${keycloakUser.realm}/protocol/openid-connect/logout`,
      undefined,
      new URLSearchParams({
        client_id: keycloakUser.apiClientId,
        refresh_token: refreshToken,
      }).toString(),
      200,
      { "content-type": "application/x-www-form-urlencoded" },
      ...ctxArgs
    );
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
