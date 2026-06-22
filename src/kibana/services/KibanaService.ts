import { BadRequestError, ConflictError, InternalError } from "@decaf-ts/db-decorators";
import { Context, ContextualArgs, MaybeContextualArg } from "@decaf-ts/core";
import { ClientBasedService, service } from "@decaf-ts/core";
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

  async initialize(...args: ContextualArgs<any>): Promise<{ config: KibanaSetupConfig; client: AxiosInstance }> {
    const { log, ctxArgs } = await this.logCtx(args, this.initialize, true);
    this._config = this.config;
    this.spaceService = new KibanaSpaceService();
    await this.spaceService.initialize(...ctxArgs);
    this.dataViewService = new KibanaDataViewService();
    await this.dataViewService.initialize(...ctxArgs);
    this.roleService = new KibanaRoleService();
    await this.roleService.initialize(...ctxArgs);
    this.userService = new KibanaUserService();
    await this.userService.initialize(...ctxArgs);
    this.dashboardService = new KibanaDashboardService();
    await this.dashboardService.initialize(...ctxArgs);
    this.authService = new KibanaAuthService();
    await this.authService.initialize(...ctxArgs);

    const client = this.createHttpClient(...ctxArgs);
    return { config: this.config, client };
  }

  async setupOrganization(...args: MaybeContextualArg<any>): Promise<KibanaSetupConfig> {
    const { log, ctxArgs } = await this.logCtx(args, this.setupOrganization, false);
    const config = ctxArgs[0] as KibanaSetupConfig;
    const realmName = config.realm;
    try {
      await this.spaceService.createSpace(
        realmName,
        config.space ?? {},
        ...ctxArgs
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }

    const dashboardId = await this.dashboardService.cloneDefaultDashboards(
      realmName,
      ...ctxArgs
    );
    if (config.dashboards && dashboardId) {
      config.dashboards = { ...config.dashboards, dashboard: dashboardId };
    }

    await this.dataViewService.createDataViews(
      realmName,
      config.dataViews,
      ...ctxArgs
    );
    await this.dataViewService.setDefaultDataView(realmName, undefined, ...ctxArgs);
    await this.roleService.createRole(realmName, config.role ?? {}, ...ctxArgs);
    await this.userService.createUser(
      config.realmApiUser,
      realmName,
      undefined,
      ...ctxArgs
    );
    await this.dashboardService.verifySpaceSetup(realmName, ...ctxArgs);

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
    return this.dashboardService.generateDashboardEmbedUrl(options);
  }

  async createSpace(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createSpace, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaSpaceConfig>;
    await this.spaceService.createSpace(realmName, payload, ...ctxArgs);
  }

  async updateSpace(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateSpace, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaSpaceConfig>;
    await this.spaceService.updateSpace(realmName, payload, ...ctxArgs);
  }

  async deleteSpace(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.deleteSpace, false);
    const realmName = ctxArgs[0] as string;
    await this.spaceService.deleteSpace(realmName, ...ctxArgs);
  }

  async createDataView(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createDataView, false);
    const realmName = ctxArgs[0] as string;
    const spec = ctxArgs[0]?.[1] as KibanaDataViewConfig;
    await this.dataViewService.createDataView(realmName, spec, ...ctxArgs);
  }

  async updateDataView(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateDataView, false);
    const realmName = ctxArgs[0] as string;
    const spec = ctxArgs[0]?.[1] as KibanaDataViewConfig;
    await this.dataViewService.updateDataView(realmName, spec, ...ctxArgs);
  }

  async createDataViews(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createDataViews, false);
    const realmName = ctxArgs[0] as string;
    const dataViews = ctxArgs[0]?.[1] as KibanaDataViewConfig[] | undefined;
    await this.dataViewService.createDataViews(realmName, dataViews ?? [], ...ctxArgs);
  }

  async setDefaultDataView(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.setDefaultDataView, false);
    const realmName = ctxArgs[0] as string;
    const dataViewId = ctxArgs[0]?.[1] as string | undefined;
    await this.dataViewService.setDefaultDataView(realmName, dataViewId, ...ctxArgs);
  }

  async cloneDefaultDashboards(...args: MaybeContextualArg<any>): Promise<string | undefined> {
    const { log, ctxArgs } = await this.logCtx(args, this.cloneDefaultDashboards, false);
    const realmName = ctxArgs[0] as string;
    return this.dashboardService.cloneDefaultDashboards(realmName, ...ctxArgs);
  }

  async createRole(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createRole, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaRoleConfig>;
    await this.roleService.createRole(realmName, payload, ...ctxArgs);
  }

  async updateRole(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateRole, false);
    const realmName = ctxArgs[0] as string;
    const payload = ctxArgs[0]?.[1] as Partial<KibanaRoleConfig>;
    await this.roleService.updateRole(realmName, payload, ...ctxArgs);
  }

  async createUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.createUser, false);
    const user = ctxArgs[0] as KibanaUser;
    const realmName = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[] | undefined;
    await this.userService.createUser(user, realmName, roleNames ?? [], ...ctxArgs);
  }

  async updateUser(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.updateUser, false);
    const user = ctxArgs[0] as KibanaUser;
    const realmName = ctxArgs[0]?.[1] as string;
    const roleNames = ctxArgs[0]?.[2] as string[] | undefined;
    await this.userService.updateUser(user, realmName, roleNames ?? [], ...ctxArgs);
  }

  async verifySpaceSetup(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.verifySpaceSetup, false);
    const realmName = ctxArgs[0] as string;
    await this.dashboardService.verifySpaceSetup(realmName, ...ctxArgs);
  }

  private createHttpClient(...args: ContextualArgs<any>): AxiosInstance {
    const config = this.resolveConfig(args);
    return Axios.create({
      baseURL: `${config.protocol}://${config.host}`,
      validateStatus: () => true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !["development", "local"].includes(config.id),
      }),
    });
  }

  private resolveConfig(args: any[]): KibanaSetupConfig {
    const configArg = args.find((arg) => arg && arg.host) as
      | KibanaSetupConfig
      | undefined;
    if (configArg) return configArg;

    if (this._config) return this._config;

    throw new InternalError("Config not provided and not initialized");
  }
}
