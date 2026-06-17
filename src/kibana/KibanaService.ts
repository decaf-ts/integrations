import axiosImport = require("axios");
import type { AxiosInstance, AxiosResponse, AxiosStatic } from "axios";
import FormData = require("form-data");
import * as fs from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
import { ConflictError, InternalError } from "@decaf-ts/db-decorators";
import type { Context } from "@decaf-ts/core";
import { createKibanaSetupConfig } from "./helpers";
import type {
  KibanaDataViewConfig,
  KibanaEnvironment,
  KibanaRoleConfig,
  KibanaServiceOptions,
  KibanaSetupConfig,
  KibanaSpaceConfig,
  KibanaUser,
} from "./types";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export class KibanaService {
  private readonly options: KibanaServiceOptions;
  private config?: KibanaSetupConfig & { assets?: string };
  private http?: AxiosInstance;

  constructor(options: KibanaServiceOptions = {}) {
    this.options = options;
  }

  async initialize(): Promise<{ config: KibanaSetupConfig & { assets?: string }; client: AxiosInstance }> {
    const config = this.ensureConfig();
    const client = this.createHttpClient(config);
    this.config = config;
    this.http = client;
    return { config, client };
  }

  setConfig(config: KibanaSetupConfig & { assets?: string }): void {
    this.config = config;
    this.http = this.createHttpClient(config);
  }

  async loginToKibana(
    user?: string,
    password?: string,
    ctx?: Context
  ): Promise<string[] | undefined> {
    const config = this.ensureConfig();
    const credentials = {
      username: user ?? config.adminApiUser?.username,
      password: password ?? config.adminApiUser?.password,
    };
    if (!credentials.username || !credentials.password) {
      throw new InternalError("Kibana login requires credentials");
    }

    const response = await this.httpRequest(
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
      }
    );

    if (response.status >= 300) {
      return undefined;
    }

    const setCookie = response.headers["set-cookie"] as string[] | undefined;
    if (!setCookie?.length) return undefined;
    return setCookie;
  }

  async setupOrganization(
    realmName: string,
    kibanaSetupConfig?: KibanaSetupConfig & { assets?: string },
    ctx?: Context
  ): Promise<KibanaSetupConfig & { assets?: string }> {
    const config = kibanaSetupConfig ?? this.createKibanaSetupConfigFromEnvironment(realmName);
    this.config = config;
    this.http = this.createHttpClient(config);

    try {
      await this.createSpace(config.realm, config.space ?? {}, ctx);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }

    const dashboardId = await this.cloneDefaultDashboards(config.realm, ctx);
    if (config.dashboards && dashboardId) {
      config.dashboards.dashboard = dashboardId;
    }

    await this.createDataViews(config.realm, config.dataViews, ctx);
    await this.setDefaultDataView(config.realm, undefined, ctx);
    await this.createRole(config.realm, config.role ?? {}, ctx);
    await this.createUser(config.realmApiUser, config.realm, undefined, ctx);
    await this.verifySpaceSetup(config.realm, ctx);

    return config;
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
    const base = `${this.ensureConfig().protocol}://${this.ensureConfig().host}`;
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

  public async createSpace(
    realmName: string,
    payload: Partial<KibanaSpaceConfig> = {},
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const response = await this.httpRequest(
      "POST",
      `/api/spaces/space`,
      this.normalizeSpaceConfig(realmName, payload),
      adminUser,
      {
        headers: { "kbn-xsrf": "true", "Content-Type": "application/json" },
      },
      200
    );
    if (response.status === 409) {
      throw new ConflictError(`Space ${realmName} already exists`);
    }
    if (response.status >= 300) {
      throw new InternalError(`Unable to create space ${realmName}`);
    }
  }

  public async updateSpace(
    realmName: string,
    payload: Partial<KibanaSpaceConfig>,
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const response = await this.httpRequest(
      "PUT",
      `/api/spaces/space/${encodeURIComponent(payload.id ?? realmName.toLowerCase())}`,
      this.normalizeSpaceConfig(realmName, payload),
      adminUser,
      {
        headers: { "kbn-xsrf": "true", "Content-Type": "application/json" },
      },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to update space ${realmName}`);
    }
  }

  public async deleteSpace(realmName: string, ctx?: Context): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const response = await this.httpRequest(
      "DELETE",
      `/api/spaces/space/${encodeURIComponent(realmName.toLowerCase())}`,
      undefined,
      adminUser,
      { headers: { "kbn-xsrf": "true" } },
      200
    );
    if (response.status >= 300 && response.status !== 204) {
      throw new InternalError(`Unable to delete space ${realmName}`);
    }
  }

  public async createDataView(
    realmName: string,
    spec: KibanaDataViewConfig,
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const payload = this.normalizeDataViewConfig(realmName, spec);
    const createResp = await this.httpRequest(
      "POST",
      `/s/${realmName}/api/data_views/data_view`,
      { data_view: payload },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );

    if (createResp.status === 200 || createResp.status === 201) return;
    if (createResp.status !== 409 && createResp.status !== 400) {
      throw new InternalError(`Unable to create data view ${payload.id}`);
    }

    await this.updateDataView(realmName, payload, ctx);
  }

  public async updateDataView(
    realmName: string,
    spec: KibanaDataViewConfig,
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const payload = this.normalizeDataViewConfig(realmName, spec);
    const response = await this.httpRequest(
      "POST",
      `/s/${realmName}/api/data_views/data_view/${encodeURIComponent(payload.id)}`,
      { data_view: payload },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to update data view ${payload.id}`);
    }
  }

  public async createDataViews(
    realmName: string,
    dataViews: KibanaDataViewConfig[] = this.ensureConfig().dataViews ?? [],
    ctx?: Context
  ): Promise<void> {
    const specs = dataViews.length > 0 ? dataViews : this.defaultDataViewConfigs(realmName);
    for (const spec of specs) {
      await this.createDataView(realmName, spec, ctx);
    }
  }

  public async setDefaultDataView(
    realmName: string,
    dataViewId?: string,
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const dvId =
      dataViewId ??
      this.ensureConfig().dataViews?.[0]?.id ??
      this.defaultDataViewConfigs(realmName)[0]?.id;
    const statusResp = await this.httpRequest(
      "GET",
      `/api/status`,
      undefined,
      adminUser,
      { headers: { "kbn-xsrf": "true" } },
      200
    );
    if (statusResp.status !== 200 || !dvId) {
      return;
    }
    const statusData = this.parseJson(statusResp.data);
    const kibanaVersion = statusData?.version?.number ?? statusData?.kibana?.version;
    if (!kibanaVersion) return;
    const response = await this.httpRequest(
      "POST",
      `/s/${realmName}/api/saved_objects/config/${kibanaVersion}?overwrite=true`,
      { attributes: { defaultIndex: dvId } },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to set default data view for ${realmName}`);
    }
  }

  public async cloneDefaultDashboards(
    realmName: string,
    ctx?: Context
  ): Promise<string | undefined> {
    const adminUser = this.ensureConfig().adminApiUser;
    const response = await this.httpRequest(
      "GET",
      `/s/default/api/saved_objects/_find?type=dashboard&per_page=1000`,
      undefined,
      adminUser,
      { headers: { "kbn-xsrf": "true" } },
      200
    );
    if (response.status !== 200) {
      throw new InternalError("Unable to list dashboards from default space");
    }
    const data = this.parseJson(response.data) ?? {};
    const dashboards: Array<{ id: string }> = data.saved_objects ?? [];
    if (dashboards.length === 0) return undefined;

    const copyResp = await this.httpRequest(
      "POST",
      `/api/spaces/_copy_saved_objects`,
      {
        spaces: [realmName],
        objects: dashboards.map((dashboard) => ({ id: dashboard.id, type: "dashboard" })),
        includeReferences: true,
        createNewCopies: true,
        overwrite: false,
      },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (copyResp.status >= 300) {
      throw new InternalError(`Unable to copy dashboards to ${realmName}`);
    }

    const assetRoot = this.ensureConfig().dashboardImportPath ?? this.ensureConfig().assets;
    if (!assetRoot) {
      return dashboards[0]?.id;
    }

    const ndjsonPath = path.join(process.cwd(), assetRoot, "pla-scan.ndjson");
    if (!fs.existsSync(ndjsonPath)) return dashboards[0]?.id;
    const form = new (FormData as any)();
    form.append("file", fs.createReadStream(ndjsonPath));
    const importResp = await axios.post(
      `${this.ensureConfig().protocol}://${this.ensureConfig().host}/s/${realmName}/api/saved_objects/_import?overwrite=true`,
      form,
      {
        auth: adminUser,
        headers: {
          ...form.getHeaders(),
          "kbn-xsrf": "true",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        httpsAgent: new https.Agent({ rejectUnauthorized: this.isSecureEnvironment() }),
      }
    );
    if (importResp.status >= 300) {
      throw new InternalError(`Unable to import dashboards for ${realmName}`);
    }
    return dashboards[0]?.id;
  }

  public async createRole(
    realmName: string,
    payload: Partial<KibanaRoleConfig> = {},
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const role = this.normalizeRoleConfig(realmName, payload);
    const response = await this.httpRequest(
      "POST",
      `${this.ensureConfig().protocol}://${this.ensureConfig().es_host}/_security/role/${encodeURIComponent(role.name)}`,
      {
        indices: role.indices,
        applications: role.applications,
        kibana: role.kibana,
        metadata: role.metadata ?? {},
      },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to create role for ${realmName}`);
    }
  }

  public async updateRole(
    realmName: string,
    payload: Partial<KibanaRoleConfig>,
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const role = this.normalizeRoleConfig(realmName, payload);
    const response = await this.httpRequest(
      "PUT",
      `${this.ensureConfig().protocol}://${this.ensureConfig().es_host}/_security/role/${encodeURIComponent(role.name)}`,
      {
        indices: role.indices,
        applications: role.applications,
        kibana: role.kibana,
        metadata: role.metadata ?? {},
      },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to update role for ${realmName}`);
    }
  }

  public async createUser(
    user: KibanaUser,
    realmName: string,
    roleNames: string[] = [],
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const defaultRole = this.normalizeRoleConfig(realmName).name;
    const payloadRoles = roleNames.length > 0 ? roleNames : [defaultRole];
    const response = await this.httpRequest(
      "POST",
      `${this.ensureConfig().protocol}://${this.ensureConfig().es_host}/_security/user/${encodeURIComponent(user.username)}`,
      {
        password: user.password,
        full_name: user.full_name,
        email: user.email,
        enabled: user.enabled ?? true,
        metadata: user.metadata ?? {},
        roles: user.roles ?? payloadRoles,
      },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to create user ${user.username}`);
    }
  }

  public async updateUser(
    user: KibanaUser,
    realmName: string,
    roleNames: string[] = [],
    ctx?: Context
  ): Promise<void> {
    const adminUser = this.ensureConfig().adminApiUser;
    const defaultRole = this.normalizeRoleConfig(realmName).name;
    const payloadRoles = roleNames.length > 0 ? roleNames : [defaultRole];
    const response = await this.httpRequest(
      "PUT",
      `${this.ensureConfig().protocol}://${this.ensureConfig().es_host}/_security/user/${encodeURIComponent(user.username)}`,
      {
        password: user.password,
        full_name: user.full_name,
        email: user.email,
        enabled: user.enabled ?? true,
        metadata: user.metadata ?? {},
        roles: user.roles ?? payloadRoles,
      },
      adminUser,
      { headers: { "kbn-xsrf": "true", "Content-Type": "application/json" } },
      200
    );
    if (response.status >= 300) {
      throw new InternalError(`Unable to update user ${user.username}`);
    }
  }

  public async verifySpaceSetup(realmName: string, ctx?: Context): Promise<void> {
    const response = await this.httpRequest(
      "GET",
      `/s/${realmName}/api/saved_objects/_find?type=dashboard&per_page=1`,
      undefined,
      this.ensureConfig().adminApiUser,
      { headers: { "kbn-xsrf": "true" } },
      200
    );
    if (response.status !== 200) {
      throw new InternalError(`Unable to verify space ${realmName}`);
    }
    const data = this.parseJson(response.data);
    if ((data?.total ?? 0) === 0) {
      throw new InternalError(`No dashboards found in space ${realmName}`);
    }
  }

  private normalizeSpaceConfig(
    realmName: string,
    payload: Partial<KibanaSpaceConfig> = {}
  ): KibanaSpaceConfig {
    const base = this.ensureConfig().space ?? {};
    const id = payload.id ?? base.id ?? realmName.toLowerCase();
    const name = payload.name ?? base.name ?? realmName.toUpperCase();
    return {
      id,
      name,
      description:
        payload.description ??
        base.description ??
        `Tenant space for ${realmName.toUpperCase()} dashboards and logs`,
      initials: payload.initials ?? base.initials ?? realmName.slice(0, 2).toUpperCase(),
      color: payload.color ?? base.color,
      disabledFeatures: payload.disabledFeatures ?? base.disabledFeatures ?? [],
      solution: payload.solution ?? base.solution ?? "classic",
      imageUrl: payload.imageUrl ?? base.imageUrl,
    };
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

  private normalizeRoleConfig(
    realmName: string,
    payload: Partial<KibanaRoleConfig> = {}
  ): KibanaRoleConfig {
    const suffix = realmName.toLowerCase();
    const base = this.ensureConfig().role ?? {};
    return {
      name: payload.name ?? base.name ?? `pla_${suffix}_reader`,
      indices:
        payload.indices ??
        base.indices ??
        [
          {
            names: [`filebeat-pla-${suffix}-*`, `metricbeat-pla-${suffix}-*`],
            privileges: ["read", "view_index_metadata"],
            allow_restricted_indices: false,
          },
        ],
      applications:
        payload.applications ??
        base.applications ??
        [
          {
            application: "kibana-.kibana",
            privileges: ["feature_discover.read", "feature_dashboard.read"],
            resources: [`space:${realmName}`],
          },
        ],
      kibana:
        payload.kibana ??
        base.kibana ??
        [
          {
            spaces: [realmName],
            base: ["read"],
          },
        ],
      metadata: payload.metadata ?? base.metadata ?? {},
    };
  }

  private ensureConfig(): KibanaSetupConfig & { assets?: string } {
    if (this.config) return this.config;
    if (this.options.config) {
      this.config = this.options.config;
      return this.config;
    }
    if (!this.options.environment) {
      throw new InternalError("KibanaService requires either config or environment");
    }
    this.config = createKibanaSetupConfig(this.options.environment);
    return this.config;
  }

  private createKibanaSetupConfigFromEnvironment(
    realmName: string
  ): KibanaSetupConfig & { assets?: string } {
    const environment = this.options.environment;
    if (!environment) {
      throw new InternalError("Kibana environment is not configured");
    }
    return createKibanaSetupConfig({ ...environment, realm: realmName });
  }

  private createHttpClient(config: KibanaSetupConfig & { assets?: string }): AxiosInstance {
    return axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({ rejectUnauthorized: this.isSecureEnvironment() }),
    });
  }

  private async httpRequest(
    method: HttpMethod,
    url: string,
    payload?: unknown,
    apiUser?: KibanaUser,
    extra: Record<string, any> = {},
    successCode = 200
  ): Promise<AxiosResponse> {
    const response = await axios.request({
      method,
      url,
      data: payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload),
      auth: apiUser
        ? { username: apiUser.username, password: apiUser.password }
        : undefined,
      validateStatus: () => true,
      httpsAgent: new https.Agent({ rejectUnauthorized: this.isSecureEnvironment() }),
      ...extra,
    });
    if (response.status !== successCode && response.status < 300) {
      return response;
    }
    return response;
  }

  private parseJson(value: unknown): any {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private isSecureEnvironment(): boolean {
    return !this.options.environment
      ? true
      : !["development", "local"].includes(this.options.environment.env ?? "");
  }
}

const axios = axiosImport as unknown as AxiosStatic;
