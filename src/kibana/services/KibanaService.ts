import { ConflictError } from "@decaf-ts/db-decorators";
import { MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService } from "@decaf-ts/core";
import type {
  KibanaDataViewConfig,
  KibanaRoleConfig,
  KibanaSetupConfig,
  KibanaSpaceConfig,
  KibanaUser,
} from "../types";
import Axios, { AxiosInstance } from "axios";
import * as https from "node:https";

import { KibanaSpaceService } from "./KibanaSpaceService";
import { KibanaDataViewService } from "./KibanaDataViewService";
import { KibanaRoleService } from "./KibanaRoleService";
import { KibanaUserService } from "./KibanaUserService";
import { KibanaDashboardService } from "./KibanaDashboardService";
import { KibanaAuthService } from "./KibanaAuthService";

type KibanaRuntimeSetupConfig = KibanaSetupConfig & {
  isProduction(): boolean;
};

/**
 * @class KibanaService
 * @summary Orchestrates Kibana setup and provisioning flows.
 * @description Boots the lower-level Kibana services, coordinates creation of spaces, data views, roles, users, dashboards, and exposes helper methods for embed URLs and organization setup.
 */
export class KibanaService extends ClientBasedService<
  AxiosInstance,
  KibanaSetupConfig
> {
  protected spaceService!: KibanaSpaceService;

  protected dataViewService!: KibanaDataViewService;

  protected roleService!: KibanaRoleService;

  protected userService!: KibanaUserService;

  protected dashboardService!: KibanaDashboardService;

  protected authService!: KibanaAuthService;

  constructor() {
    super();
  }

  protected isProduction(): boolean {
    return !["development", "local"].includes(
      process.env["NODE_ENV"] ?? ""
    );
  }

  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { ctxArgs } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config = ctxArgs[0] as KibanaSetupConfig;
    const runtimeConfig: KibanaRuntimeSetupConfig = {
      ...config,
      isProduction: this.isProduction.bind(this),
    };
    this._config = runtimeConfig;

    this.spaceService = new KibanaSpaceService();
    await this.spaceService.initialize(runtimeConfig, ...ctxArgs);
    this.dataViewService = new KibanaDataViewService();
    await this.dataViewService.initialize(runtimeConfig, ...ctxArgs);
    this.roleService = new KibanaRoleService();
    await this.roleService.initialize(runtimeConfig, ...ctxArgs);
    this.userService = new KibanaUserService();
    await this.userService.initialize(runtimeConfig, ...ctxArgs);
    this.dashboardService = new KibanaDashboardService();
    await this.dashboardService.initialize(runtimeConfig, ...ctxArgs);
    this.authService = new KibanaAuthService();
    await this.authService.initialize(runtimeConfig, ...ctxArgs);

    const client = this.createHttpClient(runtimeConfig);
    this._client = client;
    return { config, client };
  }

  async setupOrganization(
    config?: KibanaSetupConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<KibanaSetupConfig> {
    const { ctxArgs } = (
      await this.logCtx(args, "setupOrganization", true)
    ).for(this.setupOrganization);
    const effectiveConfig = config ?? this.config;
    const realmName = effectiveConfig.realm;
    try {
      await this.spaceService.createSpace(
        realmName,
        effectiveConfig.space ?? {},
        ...ctxArgs
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }

    const dashboardId = await this.dashboardService.cloneDefaultDashboards(
      realmName,
      ...ctxArgs
    );
    if (effectiveConfig.dashboards && dashboardId) {
      effectiveConfig.dashboards = { ...effectiveConfig.dashboards, dashboard: dashboardId };
    }

    await this.dataViewService.createDataViews(
      realmName,
      effectiveConfig.dataViews,
      ...ctxArgs
    );
    await this.dataViewService.setDefaultDataView(realmName, undefined, ...ctxArgs);
    await this.roleService.createRole(realmName, effectiveConfig.role ?? {}, ...ctxArgs);
    await this.userService.createUser(
      effectiveConfig.realmApiUser,
      realmName,
      undefined,
      ...ctxArgs
    );
    await this.dashboardService.verifySpaceSetup(realmName, ...ctxArgs);

    return effectiveConfig;
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
    return this.dashboardService.generateDashboardEmbedUrl(options);
  }

  async createSpace(
    realmName: string,
    payload: Partial<KibanaSpaceConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createSpace", true)
    ).for(this.createSpace);
    await this.spaceService.createSpace(realmName, payload, ...ctxArgs);
  }

  async updateSpace(
    realmName: string,
    payload: Partial<KibanaSpaceConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateSpace", true)
    ).for(this.updateSpace);
    await this.spaceService.updateSpace(realmName, payload, ...ctxArgs);
  }

  async deleteSpace(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "deleteSpace", true)
    ).for(this.deleteSpace);
    await this.spaceService.deleteSpace(realmName, ...ctxArgs);
  }

  async createDataView(
    realmName: string,
    spec: KibanaDataViewConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createDataView", true)
    ).for(this.createDataView);
    await this.dataViewService.createDataView(realmName, spec, ...ctxArgs);
  }

  async updateDataView(
    realmName: string,
    spec: KibanaDataViewConfig,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateDataView", true)
    ).for(this.updateDataView);
    await this.dataViewService.updateDataView(realmName, spec, ...ctxArgs);
  }

  async createDataViews(
    realmName: string,
    dataViews: KibanaDataViewConfig[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createDataViews", true)
    ).for(this.createDataViews);
    await this.dataViewService.createDataViews(
      realmName,
      dataViews ?? [],
      ...ctxArgs
    );
  }

  async setDefaultDataView(
    realmName: string,
    dataViewId: string | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "setDefaultDataView", true)
    ).for(this.setDefaultDataView);
    await this.dataViewService.setDefaultDataView(
      realmName,
      dataViewId,
      ...ctxArgs
    );
  }

  async cloneDefaultDashboards(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<string | undefined> {
    const { ctxArgs } = (
      await this.logCtx(args, "cloneDefaultDashboards", true)
    ).for(this.cloneDefaultDashboards);
    return this.dashboardService.cloneDefaultDashboards(realmName, ...ctxArgs);
  }

  async createRole(
    realmName: string,
    payload: Partial<KibanaRoleConfig> | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createRole", true)
    ).for(this.createRole);
    await this.roleService.createRole(realmName, payload, ...ctxArgs);
  }

  async updateRole(
    realmName: string,
    payload: Partial<KibanaRoleConfig>,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateRole", true)
    ).for(this.updateRole);
    await this.roleService.updateRole(realmName, payload, ...ctxArgs);
  }

  async createUser(
    user: KibanaUser,
    realmName: string,
    roleNames: string[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "createUser", true)
    ).for(this.createUser);
    await this.userService.createUser(
      user,
      realmName,
      roleNames ?? [],
      ...ctxArgs
    );
  }

  async updateUser(
    user: KibanaUser,
    realmName: string,
    roleNames: string[] | undefined,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "updateUser", true)
    ).for(this.updateUser);
    await this.userService.updateUser(
      user,
      realmName,
      roleNames ?? [],
      ...ctxArgs
    );
  }

  async verifySpaceSetup(
    realmName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctxArgs } = (
      await this.logCtx(args, "verifySpaceSetup", true)
    ).for(this.verifySpaceSetup);
    await this.dashboardService.verifySpaceSetup(realmName, ...ctxArgs);
  }

  private createHttpClient(config: KibanaSetupConfig): AxiosInstance {
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.isProduction(),
      }),
    });
  }
}
