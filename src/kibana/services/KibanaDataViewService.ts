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
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";
import { KibanaAuthService } from "./KibanaAuthService";
import { parseJsonBody } from "../../shared/runtime";

export class KibanaDataViewService extends ClientBasedService<
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

  async createDataView(
    realmName: string,
    spec: KibanaDataViewConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createDataView", true)
    ).for(this.createDataView);
    const payload = this.normalizeDataViewConfig(realmName, spec);
    const createResp = await this.request(
      "POST",
      `/s/${realmName}/api/data_views/data_view`,
      { data_view: payload },
      this.config.adminApiUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200,
      ...ctxArgs
    );

    if (createResp.status === 200 || createResp.status === 201) return;
    if (createResp.status !== 409 && createResp.status !== 400) {
      const message = `Unable to create data view ${payload.id}: ${createResp.statusText}`;
      throw new BadRequestError(message);
    }

    await this.updateDataView(realmName, payload, ...ctxArgs);
  }

  async updateDataView(
    realmName: string,
    spec: KibanaDataViewConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateDataView", true)
    ).for(this.updateDataView);
    const payload = this.normalizeDataViewConfig(realmName, spec);
    const { id, ...updatePayload } = payload;
    const response = await this.request(
      "POST",
      `/s/${realmName}/api/data_views/data_view/${encodeURIComponent(id)}`,
      { data_view: updatePayload },
      this.config.adminApiUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200,
      ...ctxArgs
    );
    if (response.status >= 300) {
      const message = `Unable to update data view ${payload.id}: ${response.statusText}`;
      throw new BadRequestError(message);
    }
  }

  async createDataViews(
    realmName: string,
    dataViews: KibanaDataViewConfig[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createDataViews", true)
    ).for(this.createDataViews);
    const specs =
      dataViews && dataViews.length > 0
        ? dataViews
        : this.defaultDataViewConfigs(realmName);
    for (const spec of specs) {
      await this.createDataView(realmName, spec, ...ctxArgs);
    }
  }

  async setDefaultDataView(
    realmName: string,
    dataViewId: string | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "setDefaultDataView", true)
    ).for(this.setDefaultDataView);
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
      200,
      ...ctxArgs
    );
    if (statusResp.status !== 200 || !dvId) {
      return;
    }
    const statusData = parseJsonBody<any>(statusResp.data);
    const kibanaVersion =
      statusData?.version?.number ?? statusData?.kibana?.version;
    if (!kibanaVersion) return;
    const response = await this.request(
      "POST",
      `/s/${realmName}/api/saved_objects/config/${kibanaVersion}?overwrite=true`,
      { attributes: { defaultIndex: dvId } },
      this.config.adminApiUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200,
      ...ctxArgs
    );
    if (response.status >= 300) {
      const message = `Unable to set default data view for ${realmName}: ${response.statusText}`;
      throw new BadRequestError(message);
    }
  }

  private createHttpClient(config: KibanaSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.isProduction(),
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
        rejectUnauthorized: this.config.isProduction(),
      }),
      ...extra,
    });
  }
}
