import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type { KibanaSetupConfig, KibanaUser } from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { resolveKibanaIsProduction } from "./runtime";

export class KibanaAuthService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { ctxArgs } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config = ctxArgs[0] as KibanaSetupConfig;
    this._config = config;
    const client = this.createHttpClient(config);
    this._client = client;
    return { config, client };
  }

  async loginToKibana(
    username: string | undefined,
    password: string | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<string[] | undefined> {
    const { ctxArgs } = (
      await this.logCtx(args, "loginToKibana", true)
    ).for(this.loginToKibana);
    const config = this.config;
    const credentials = {
      username: username ?? config.adminApiUser?.username,
      password: password ?? config.adminApiUser?.password,
    };
    if (!credentials.username || !credentials.password) {
      throw new BadRequestError("Kibana login requires credentials");
    }

    const response = await this.request(
      "POST",
      `${config.protocol}://${config.host}/internal/security/login`,
      {
        providerType: "basic",
        providerName: "basic",
        currentURL: "/login",
      },
      undefined,
      {
        auth: credentials,
        headers: {
          "kbn-xsrf": "true",
          "content-type": "application/json",
        },
        withCredentials: true,
        httpsAgent: new https.Agent({
          rejectUnauthorized: (resolveKibanaIsProduction(this.config as any)),
        }),
      },
      200,
      ...ctxArgs
    );

    if (response.status >= 300) {
      const message = `Kibana login failed: ${response.statusText}`;
      throw new BadRequestError(message);
    }

    const setCookie = response.headers["set-cookie"] as string[] | undefined;
    if (!setCookie?.length) return undefined;
    return setCookie;
  }

  async logout(
    user: KibanaUser,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "logout", true)
    ).for(this.logout);
    await this.request(
      "POST",
      `${this.config.protocol}://${this.config.host}/logout`,
      undefined,
      user,
      {
        headers: { "kbn-xsrf": "true" },
      },
      200,
      ...ctxArgs
    );
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

  private createHttpClient(config: KibanaSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: (resolveKibanaIsProduction(this.config as any)),
      }),
    });
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload: unknown,
    apiUser: KibanaUser | undefined,
    extra: Record<string, any>,
    successCode: number,
    ...args: ContextualArgs<any>
  ): Promise<any> {
    this.logCtx(args, this.request);
    return this.client.request({
      method,
      url,
      data:
        payload === undefined
          ? undefined
          : typeof payload === "string"
            ? payload
            : JSON.stringify(payload),
      auth: apiUser
        ? { username: apiUser.username, password: apiUser.password }
        : undefined,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: (resolveKibanaIsProduction(this.config as any)),
      }),
      ...extra,
    });
  }
}
