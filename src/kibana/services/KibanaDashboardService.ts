import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { Context, ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
import type {
  KibanaDashboardTargets,
  KibanaSetupConfig,
  KibanaUser,
} from "../types";
import Axios, { type AxiosInstance } from "axios";
import * as fs from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
import FormData from "form-data";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaDashboardService extends ClientBasedService<
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

  async cloneDefaultDashboards(...args: MaybeContextualArg<any>): Promise<string | undefined> {
    const { log, ctxArgs } = await this.logCtx(args, this.cloneDefaultDashboards, false);
    const realmName = ctxArgs[0] as string;
    const response = await this.request(
      "GET",
      `/s/default/api/saved_objects/_find?type=dashboard&per_page=1000`,
      undefined,
      undefined,
      { headers: { "kbn-xsrf": "true" } },
      ...ctxArgs,
      200
    );
    if (response.status !== 200) {
      const operation = "List dashboards";
      const message = `Unable to list dashboards from default space: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
    const data = this.parseJson(response.data) ?? {};
    const dashboards: Array<{ id: string }> = data.saved_objects ?? [];
    if (dashboards.length === 0) return undefined;

    const copyResp = await this.request(
      "POST",
      `/api/spaces/_copy_saved_objects`,
      {
        spaces: [realmName],
        objects: dashboards.map((dashboard) => ({
          id: dashboard.id,
          type: "dashboard",
        })),
        includeReferences: true,
        createNewCopies: true,
        overwrite: false,
      },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (copyResp.status >= 300) {
      const operation = "Copy dashboards";
      const message = `Unable to copy dashboards to ${realmName}: ${copyResp.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }

    const assetRoot = this.config.dashboardImportPath ?? this.config.assets;
    if (!assetRoot) {
      return dashboards[0]?.id;
    }

    const ndjsonPath = path.join(process.cwd(), assetRoot, "pla-scan.ndjson");
    if (!fs.existsSync(ndjsonPath)) return dashboards[0]?.id;
    const form = new (FormData as any)();
    form.append("file", fs.createReadStream(ndjsonPath));
    const importResp = await Axios.post(
      `${this.config.protocol}://${this.config.host}/s/${realmName}/api/saved_objects/_import?overwrite=true`,
      form,
      {
        auth: undefined,
        headers: {
          ...form.getHeaders(),
          "kbn-xsrf": "true",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        httpsAgent: new https.Agent({
          rejectUnauthorized: this.isSecureEnvironment(),
        }),
      }
    );
    if (importResp.status >= 300) {
      const operation = "Import dashboards";
      const message = `Unable to import dashboards for ${realmName}: ${importResp.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
    return dashboards[0]?.id;
  }

  generateDashboardEmbedUrl(options: {
    space: string;
    dashboardId: string;
    showTimeFilter?: boolean;
    showQueryInput?: boolean;
    showFilterBar?: boolean;
    hidePanelTitles?: boolean;
    timeRange?: { from: string; to: string };
  }): string {
    const {
      space,
      dashboardId,
      showTimeFilter = false,
      showQueryInput = false,
      showFilterBar = false,
      hidePanelTitles = false,
      timeRange,
    } = options;
    const base = `${this.config.protocol}://${this.config.host}`;
    const params = new URLSearchParams({ embed: "true" });
    if (showTimeFilter) params.set("show-time-filter", "true");
    if (showQueryInput) params.set("show-query-input", "true");
    if (showFilterBar) params.set("show-filter-bar", "true");
    if (hidePanelTitles) params.set("hide-panel-titles", "true");
    const timeFragment = timeRange
      ? `&_g=${encodeURIComponent(JSON.stringify({ time: timeRange }))}`
      : "";
    return `${base}/s/${space}/app/dashboards#/view/${dashboardId}?${params.toString()}${timeFragment}`;
  }

  async verifySpaceSetup(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.verifySpaceSetup, false);
    const realmName = ctxArgs[0] as string;
    const response = await this.request(
      "GET",
      `/s/${realmName}/api/saved_objects/_find?type=dashboard&per_page=1`,
      undefined,
      undefined,
      { headers: { "kbn-xsrf": "true" } },
      ...ctxArgs,
      200
    );
    if (response.status !== 200) {
      const operation = "Verify space setup";
      const message = `Unable to verify space ${realmName}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
    const data = this.parseJson(response.data);
    if ((data?.total ?? 0) === 0) {
      const operation = "Verify space setup";
      const message = `No dashboards found in space ${realmName}`;
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
