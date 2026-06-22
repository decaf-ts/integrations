import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
import type {
  KibanaDataViewConfig,
  KibanaSetupConfig,
  KibanaUser,
} from "../types";
import type { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";

export class KibanaDataViewService extends ClientBasedService<
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
    const client = this.createHttpClient(ctxArgs[0] as KibanaSetupConfig);
    return { config: this.config, client };
  }

  async createDataView(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.createDataView,
      false
    );
    const realmName = ctxArgs[0] as string;
    const spec = ctxArgs[0]?.[1] as KibanaDataViewConfig;
    const payload = this.normalizeDataViewConfig(realmName, spec);
    const createResp = await this.request(
      "POST",
      `/s/${realmName}/api/data_views/data_view`,
      { data_view: payload },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );

    if (createResp.status === 200 || createResp.status === 201) return;
    if (createResp.status !== 409 && createResp.status !== 400) {
      const operation = "Create data view";
      const message = `Unable to create data view ${payload.id}: ${createResp.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }

    await this.updateDataView(realmName, payload, ...ctxArgs);
  }

  async updateDataView(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.updateDataView,
      false
    );
    const realmName = ctxArgs[0] as string;
    const spec = ctxArgs[0]?.[1] as KibanaDataViewConfig;
    const payload = this.normalizeDataViewConfig(realmName, spec);
    const response = await this.request(
      "POST",
      `/s/${realmName}/api/data_views/data_view/${encodeURIComponent(payload.id)}`,
      { data_view: payload },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Update data view";
      const message = `Unable to update data view ${payload.id}: ${response.statusText}`;
      throw this.parseError(new Error(message), message, operation);
    }
  }

  async createDataViews(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.createDataViews,
      false
    );
    const realmName = ctxArgs[0] as string;
    const dataViews = ctxArgs[0]?.[1] as KibanaDataViewConfig[] | undefined;
    const specs =
      dataViews && dataViews.length > 0
        ? dataViews
        : this.defaultDataViewConfigs(realmName);
    for (const spec of specs) {
      await this.createDataView(realmName, spec, ...ctxArgs);
    }
  }

  async setDefaultDataView(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.setDefaultDataView,
      false
    );
    const realmName = ctxArgs[0] as string;
    const dataViewId = ctxArgs[0]?.[1] as string | undefined;
    const dvId =
      dataViewId ??
      this.config.dataViews?.[0]?.id ??
      this.defaultDataViewConfigs(realmName)[0]?.id;
    const statusResp = await this.request(
      "GET",
      `/api/status`,
      undefined,
      undefined,
      { headers: { "kbn-xsrf": "true" } },
      ...ctxArgs,
      200
    );
    if (statusResp.status !== 200 || !dvId) {
      return;
    }
    const statusData = this.parseJson(statusResp.data);
    const kibanaVersion =
      statusData?.version?.number ?? statusData?.kibana?.version;
    if (!kibanaVersion) return;
    const response = await this.request(
      "POST",
      `/s/${realmName}/api/saved_objects/config/${kibanaVersion}?overwrite=true`,
      { attributes: { defaultIndex: dvId } },
      undefined,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      ...ctxArgs,
      200
    );
    if (response.status >= 300) {
      const operation = "Set default data view";
      const message = `Unable to set default data view for ${realmName}: ${response.statusText}`;
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

  private normalizeDataViewConfig(
    realmName: string,
    spec: KibanaDataViewConfig
  ): KibanaDataViewConfig {
    const suffix = realmName.toLowerCase();
    return {
      ...spec,
      name: spec.name ?? spec.id,
      title:
        spec.title ??
        (spec.id.includes("filebeat")
          ? `filebeat-pla-${suffix}-*`
          : `metricbeat-pla-${suffix}-*`),
      timeFieldName: spec.timeFieldName ?? "@timestamp",
    };
  }

  private defaultDataViewConfigs(realmName: string): KibanaDataViewConfig[] {
    const suffix = realmName.toLowerCase();
    return [
      {
        id: `filebeat_pla_${suffix}`,
        name: `PLA Filebeat Logs (${realmName})`,
        title: `filebeat-pla-${suffix}-*`,
        timeFieldName: "@timestamp",
      },
      {
        id: `logs_pla_${suffix}`,
        name: `PLA Metricbeat Logs (${realmName})`,
        title: `metricbeat-pla-${suffix}-*`,
        timeFieldName: "@timestamp",
      },
    ];
  }

  private request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
    apiUser?: KibanaUser,
    extra: Record<string, any> = {},
    ...args: ContextualArgs<any>
  ): Promise<any> {
    const successCode = (args.pop() as number) || 200;
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
