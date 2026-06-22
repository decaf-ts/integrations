import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
import type {
  KibanaSetupConfig,
  KibanaSpaceConfig,
  KibanaUser,
} from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaSpaceService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  @service()
  protected authService!: KibanaAuthService;

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

  async createSpace(
    realmName: string,
    payload: Partial<KibanaSpaceConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createSpace", true)
    ).for(this.createSpace);
    const response = await this.request(
      "POST",
      "/api/spaces/space",
      this.normalizeSpaceConfig(realmName, payload),
      this.config.adminApiUser,
      {
        headers: { "kbn-xsrf": "true", "Content-Type": "application/json" },
      },
      200,
      ...ctxArgs
    );
    if (response.status === 409) {
      const message = `Space ${realmName} already exists`;
      throw new ConflictError(message);
    }
    if (response.status >= 300) {
      const message = `Unable to create space ${realmName}: ${response.statusText}`;
      throw new BadRequestError(message);
    }
  }

  async updateSpace(
    realmName: string,
    payload: Partial<KibanaSpaceConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateSpace", true)
    ).for(this.updateSpace);
    const normalized = this.normalizeSpaceConfig(realmName, payload);
    const response = await this.request(
      "PUT",
      `/api/spaces/space/${encodeURIComponent(payload.id ?? realmName.toLowerCase())}`,
      normalized,
      this.config.adminApiUser,
      {
        headers: { "kbn-xsrf": "true", "Content-Type": "application/json" },
      },
      200,
      ...ctxArgs
    );
    if (response.status >= 300) {
      const message = `Unable to update space ${realmName}: ${response.statusText}`;
      throw new BadRequestError(message);
    }
  }

  async deleteSpace(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "deleteSpace", true)
    ).for(this.deleteSpace);
    const response = await this.request(
      "DELETE",
      `/api/spaces/space/${encodeURIComponent(realmName.toLowerCase())}`,
      undefined,
      this.config.adminApiUser,
      { headers: { "kbn-xsrf": "true" } },
      200,
      ...ctxArgs
    );
    if (response.status >= 300 && response.status !== 204) {
      const message = `Unable to delete space ${realmName}: ${response.statusText}`;
      throw new BadRequestError(message);
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

  private isSecureEnvironment(): boolean {
    return (
      !this.config.id || !["development", "local"].includes(this.config.id)
    );
  }

  private normalizeSpaceConfig(
    realmName: string,
    payload: Partial<KibanaSpaceConfig> = {}
  ): KibanaSpaceConfig {
    const base = this.config.space ?? {};
    const id = payload.id ?? base.id ?? realmName.toLowerCase();
    const name = payload.name ?? base.name ?? realmName.toUpperCase();
    return {
      id,
      name,
      description:
        payload.description ??
        base.description ??
        `Tenant space for ${realmName.toUpperCase()} dashboards and logs`,
      initials:
        payload.initials ??
        base.initials ??
        realmName.slice(0, 2).toUpperCase(),
      color: payload.color ?? base.color,
      disabledFeatures: payload.disabledFeatures ?? base.disabledFeatures ?? [],
      solution: payload.solution ?? base.solution,
      imageUrl: payload.imageUrl ?? base.imageUrl,
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
