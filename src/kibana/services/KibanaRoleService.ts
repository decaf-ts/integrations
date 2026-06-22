import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { Context, ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
import type { KibanaRoleConfig, KibanaSetupConfig, KibanaUser } from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaRoleService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  @service()
  protected authService!: KibanaAuthService;

  async initialize(...args: ContextualArgs<any>): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { log, ctxArgs } = await this.logCtx(args, this.initialize, true);
    this._config = this.config;
    const client = this.createHttpClient(...ctxArgs);
    return { config: this.config, client };
  }

  async createRole(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createRole, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaRoleConfig> | undefined;
    const role = this.normalizeRoleConfig(realmName, payload);
    const response = await this.request(
      "POST",
      `${this.config.protocol}://${this.config.es_host}/_security/role/${encodeURIComponent(role.name)}`,
      {
        indices: role.indices,
        applications: role.applications,
        kibana: role.kibana,
        metadata: role.metadata ?? {},
      },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Create role";
      const message = `Unable to create role for ${realmName}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
  }

  async updateRole(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateRole, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaRoleConfig>;
    const role = this.normalizeRoleConfig(realmName, payload);
    const response = await this.request(
      "PUT",
      `${this.config.protocol}://${this.config.es_host}/_security/role/${encodeURIComponent(role.name)}`,
      {
        indices: role.indices,
        applications: role.applications,
        kibana: role.kibana,
        metadata: role.metadata ?? {},
      },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Update role";
      const message = `Unable to update role for ${realmName}: ${response.statusText}`;
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
    payload: Partial<KibanaRoleConfig> = {}
  ): KibanaRoleConfig {
    const suffix = realmName.toLowerCase();
    const base = this.config.role ?? {};
    return {
      name: payload.name ?? base.name ?? `pla_${suffix}_reader`,
      indices: payload.indices ??
        base.indices ?? [
          {
            names: [`filebeat-pla-${suffix}-*`, `metricbeat-pla-${suffix}-*`],
            privileges: ["read", "view_index_metadata"],
            allow_restricted_indices: false,
          },
        ],
      applications: payload.applications ??
        base.applications ?? [
          {
            application: "kibana-.kibana",
            privileges: ["feature_discover.read", "feature_dashboard.read"],
            resources: [`space:${realmName}`],
          },
        ],
      kibana: payload.kibana ??
        base.kibana ?? [
          {
            spaces: [realmName],
            base: ["read"],
          },
        ],
      metadata: payload.metadata ?? base.metadata ?? {},
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
