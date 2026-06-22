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
import type { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaSpaceService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  @service()
  protected authService!: KibanaAuthService;

  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { ctx } = await this.logCtx(args, this.initialize, true);
    this._config = this.config;
    const client = this.createHttpClient(ctx);
    return { config: this.config, client };
  }

  async createSpace(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createSpace, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaSpaceConfig>;
    const response = await this.request(
      "POST",
      "/api/spaces/space",
      this.normalizeSpaceConfig(realmName, payload),
      undefined,
      {
        headers: { "kbn-xsrf": "true", "Content-Type": "application/json" },
      },
      ...ctxArgs,
      200
    );
    if (response.status === 409) {
      const operation = "Create space";
      const message = `Space ${realmName} already exists`;
      throw this.parseError(new Error(message), message, operation);
    }
    if (response.status >= 300) {
      const operation = "Create space";
      const message = `Unable to create space ${realmName}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
  }

  async updateSpace(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateSpace, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaSpaceConfig>;
    const response = await this.request(
      "PUT",
      `/api/spaces/space/${encodeURIComponent(payload.id ?? realmName.toLowerCase())}`,
      this.normalizeSpaceConfig(realmName, payload),
      undefined,
      {
        headers: { "kbn-xsrf": "true", "Content-Type": "application/json" },
      },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Update space";
      const message = `Unable to update space ${realmName}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
  }

  async deleteSpace(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.deleteSpace, false);
    const realmName = ctxArgs[0] as string;
    const response = await this.request(
      "DELETE",
      `/api/spaces/space/${encodeURIComponent(realmName.toLowerCase())}`,
      undefined,
      undefined,
      { headers: { "kbn-xsrf": "true" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300 && response.status !== 204) {
      const operation = "Delete space";
      const message = `Unable to delete space ${realmName}: ${response.statusText}`;
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
      solution: payload.solution ?? base.solution ?? "classic",
      imageUrl: payload.imageUrl ?? base.imageUrl,
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
