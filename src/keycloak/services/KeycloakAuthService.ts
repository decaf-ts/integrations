import {
  BadRequestError,
  ConflictError,
  InternalError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type { KeycloakSetupConfig, KeycloakUser } from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";

export class KeycloakAuthService extends ClientBasedService<
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

  async getAccessToken(...args: MaybeContextualArg<any>): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(args, this.getAccessToken, true);
    const keycloakUser = ctxArgs[0] as KeycloakUser;

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
      ...ctxArgs,
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

  async refreshAccessToken(...args: MaybeContextualArg<any>): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.refreshAccessToken,
      true
    );
    const refreshToken = ctxArgs[0] as string;
    const clientId = ctxArgs[0]?.[1] as string;
    const clientSecret = ctxArgs[0]?.[2] as string;

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
      ...ctxArgs,
      200,
      { "content-type": "application/x-www-form-urlencoded" }
    );

    const data = this.parseJsonResponse<{ access_token?: string }>(
      response.data
    );
    if (data?.access_token) return data.access_token;

    throw new BadRequestError("Unable to refresh Keycloak access token");
  }

  async validateAccessToken(
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.validateAccessToken,
      true
    );
    const accessToken = ctxArgs[0] as string;

    try {
      await this.request(
        "GET",
        `/realms/${this.config.realmApiUser!.realm}/protocol/openid-connect/userinfo`,
        accessToken,
        undefined,
        ...ctxArgs,
        200
      );
      return true;
    } catch (error: any) {
      return false;
    }
  }

  async logout(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.logout, true);
    const keycloakUser = ctxArgs[0] as KeycloakUser;
    const refreshToken = ctxArgs[0]?.[1] as string;

    await this.request(
      "POST",
      `/realms/${keycloakUser.realm}/protocol/openid-connect/logout`,
      undefined,
      new URLSearchParams({
        client_id: keycloakUser.apiClientId,
        refresh_token: refreshToken,
      }).toString(),
      ...ctxArgs,
      200,
      { "content-type": "application/x-www-form-urlencoded" }
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

  private async request(...requestArgs: any[]): Promise<any> {
    const method = requestArgs[0] as "GET" | "POST" | "PUT" | "DELETE";
    const path = requestArgs[1] as string;
    const accessToken = requestArgs[2] as string | undefined;
    const payload = requestArgs[3];
    const ctxArgs = requestArgs.slice(4);
    const successCode = (ctxArgs.pop() as number) || 200;
    const headers = (ctxArgs.pop() as Record<string, string>) || {};

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
