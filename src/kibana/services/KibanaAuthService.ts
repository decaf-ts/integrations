import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type { KibanaSetupConfig, KibanaUser } from "../types";
import type { AxiosInstance } from "axios";
import * as https from "node:https";

export class KibanaAuthService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { log, ctxArgs } = await this.logCtx(args, this.initialize, true);
    const config = this.resolveConfig(ctxArgs);
    const client = this.createHttpClient(config);
    return { config, client };
  }

  async loginToKibana(
    ...args: MaybeContextualArg<any>
  ): Promise<string[] | undefined> {
    const { log, ctxArgs } = await this.logCtx(args, this.loginToKibana, false);
    const config = this.config;
    const user = ctxArgs[0] as string | undefined;
    const password = ctxArgs[0]?.[1] as string | undefined;
    const credentials = {
      username: user ?? config.adminApiUser?.username,
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
          rejectUnauthorized: this.isSecureEnvironment(),
        }),
      },
      ...ctxArgs,
      200
    );

    if (response.status >= 300) {
      const operation = "Kibana login";
      const message = `Kibana login failed: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }

    const setCookie = response.headers["set-cookie"] as string[] | undefined;
    if (!setCookie?.length) return undefined;
    return setCookie;
  }

  async logout(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.logout, false);
    const user = ctxArgs[0] as KibanaUser;
    await this.request(
      "POST",
      `${this.config.protocol}://${this.config.host}/logout`,
      undefined,
      user,
      {
        headers: { "kbn-xsrf": "true" },
      },
      ...ctxArgs,
      200
    );
  }

  private resolveConfig(args: any[]): KibanaSetupConfig {
    const configArg = args.find((arg) => arg && arg.host) as
      | KibanaSetupConfig
      | undefined;
    if (configArg) return configArg;

    if (this._config) return this._config;

    const operation = "Kibana config resolution";
    const message = "Config not provided and not initialized";
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

  private createHttpClient(...args: ContextualArgs<any>): AxiosInstance {
    const config = this.resolveConfig(args);
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isSecureEnvironment(),
      }),
    });
  }

  private isSecureEnvironment(): boolean {
    return (
      !this.config.id || !["development", "local"].includes(this.config.id)
    );
  }

  private request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
    apiUser?: KibanaUser,
    extra: Record<string, any> = {},
    successCode = 200,
    ...args: ContextualArgs<any>
  ): Promise<any> {
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
        rejectUnauthorized: this.isSecureEnvironment(),
      }),
      ...extra,
    });
  }
}
