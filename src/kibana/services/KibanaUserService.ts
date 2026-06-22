import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { Context, ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
import type { KibanaSetupConfig, KibanaUser } from "../types";
import type { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaUserService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  @service()
  protected authService!: KibanaAuthService;

  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { log, ctxArgs } = await this.logCtx(args, this.initialize, true);
    this._config = this.config;
    const client = this.createHttpClient(...ctxArgs);
    return { config: this.config, client };
  }

  async createUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createUser, false);
    const user = ctxArgs[0] as KibanaUser;
    const realmName = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[] | undefined;
    const defaultRole = this.normalizeRoleConfig(realmName).name;
    const payloadRoles =
      roleNames && roleNames.length > 0 ? roleNames : [defaultRole];
    const response = await this.request(
      "POST",
      `${this.config.protocol}://${this.config.es_host}/_security/user/${encodeURIComponent(user.username)}`,
      {
        password: user.password,
        full_name: user.full_name,
        email: user.email,
        enabled: user.enabled ?? true,
        metadata: user.metadata ?? {},
        roles: user.roles ?? payloadRoles,
      },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Create user";
      const message = `Unable to create user ${user.username}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
  }

  async updateUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateUser, false);
    const user = ctxArgs[0] as KibanaUser;
    const realmName = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[] | undefined;
    const defaultRole = this.normalizeRoleConfig(realmName).name;
    const payloadRoles =
      roleNames && roleNames.length > 0 ? roleNames : [defaultRole];
    const response = await this.request(
      "PUT",
      `${this.config.protocol}://${this.config.es_host}/_security/user/${encodeURIComponent(user.username)}`,
      {
        password: user.password,
        full_name: user.full_name,
        email: user.email,
        enabled: user.enabled ?? true,
        metadata: user.metadata ?? {},
        roles: user.roles ?? payloadRoles,
      },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Update user";
      const message = `Unable to update user ${user.username}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
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

  private isSecureEnvironment(): boolean {
    return (
      !this.config.id || !["development", "local"].includes(this.config.id)
    );
  }

  private normalizeRoleConfig(
    realmName: string,
    payload: Partial<{ name?: string }> = {}
  ): { name: string } {
    const suffix = realmName.toLowerCase();
    const base = this.config.role ?? {};
    return {
      name: payload.name ?? base.name ?? `pla_${suffix}_reader`,
    };
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

  private parseJson(value: unknown): any {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
