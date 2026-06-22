import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
import type { KibanaSetupConfig, KibanaUser } from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaUserService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  @service()
  protected authService!: KibanaAuthService;

  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { ctxArgs } = (await this.logCtx(args, "initialize", true)).for(
      this.initialize
    );
    const config = ctxArgs[0] as KibanaSetupConfig;
    this._config = config;
    const client = this.createHttpClient(config);
    this._client = client;
    return { config, client };
  }

  async createUser(
    user: KibanaUser,
    realmName: string,
    roleNames: string[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "createUser", true)).for(
      this.createUser
    );
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
      this.config.adminApiUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200,
      ...ctxArgs
    );
    if (response.status >= 300) {
      const message = `Unable to create user ${user.username}: ${response.statusText}`;
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
  }

  async updateUser(
    user: KibanaUser,
    realmName: string,
    roleNames: string[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (await this.logCtx(args, "updateUser", true)).for(
      this.updateUser
    );
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
      this.config.adminApiUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200,
      ...ctxArgs
    );
    if (response.status >= 300) {
      const message = `Unable to update user ${user.username}: ${response.statusText}`;
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
  }

  private createHttpClient(config: KibanaSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isSecureEnvironment(),
      }),
    });
  }

  protected parseError(error: Error): Error {
    const message = error.message || error.name || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new NotFoundError(message);
    }

    if (
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new ConflictError(message);
    }

    if (
      lowerMessage.includes("invalid") ||
      lowerMessage.includes("bad request") ||
      lowerMessage.includes("400")
    ) {
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
        rejectUnauthorized: this.isSecureEnvironment(),
      }),
      ...extra,
    });
  }
}
