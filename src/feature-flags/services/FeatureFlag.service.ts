import {
  Condition,
  ModelService,
  Repository,
  repository,
  service,
} from "@decaf-ts/core";
import type { Repo } from "@decaf-ts/core";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { FeatureFlagEnvironment } from "../environment";
import { FeatureFlagAccess } from "../models/FeatureFlagAccess.model";
import { FeatureFlag } from "../models/FeatureFlag.model";
import {
  EnvironmeFlagReader,
  FeatureFlagReader,
  FeatureFlagReaderLike,
} from "../readers";
import type {
  FeatureFlagAccessInput,
  FeatureFlagAccessQuery,
  FeatureFlagAccessSubject,
  FeatureFlagConfig,
  FeatureFlagReaderConfig,
  FeatureFlagReaderInput,
  FeatureFlagRegistry,
} from "../types";
import {
  isFeatureFlagEnabled,
  isFeatureFlagEnabledByName,
  normalizeFeatureName,
} from "../utils";
import { normalizeFeatureSubjectKey, normalizeFeatureSubjectType } from "../utils";

export interface FeatureFlagServiceConfig extends FeatureFlagReaderConfig {
  reader?: FeatureFlagReaderLike;
  repository?: Repository<FeatureFlag, any>;
}

@service(FeatureFlag)
export class FeatureFlagService extends ModelService<FeatureFlag> {
  private reader: FeatureFlagReader = new EnvironmeFlagReader();
  private cachedRegistry: FeatureFlagRegistry = {};
  @repository(FeatureFlagAccess)
  protected accessRepository!: Repo<FeatureFlagAccess>;

  constructor() {
    super(FeatureFlag);
  }

  async initialize(
    ...args: any[]
  ): Promise<{ config: FeatureFlagServiceConfig; client: FeatureFlagReader }> {
    const config = (args[0] as FeatureFlagServiceConfig | undefined) ?? {};
    if (config.repository) {
      this._repository = config.repository as any;
    }
    this.reader = !config.reader
      ? new EnvironmeFlagReader()
      : typeof config.reader === "function"
        ? new config.reader()
        : config.reader;
    const readerConfig = {
      ...(config.readerConfig ?? {}),
      source: config.readerConfig?.source ?? FeatureFlagEnvironment,
    };
    this.cachedRegistry = await this.refreshCachedRegistry(readerConfig, ...args);
    const effectiveConfig: FeatureFlagServiceConfig = {
      ...config,
      reader: this.reader,
      readerConfig,
    };
    return { config: effectiveConfig, client: this.reader };
  }

  private cloneRegistry(registry: FeatureFlagRegistry): FeatureFlagRegistry {
    return Object.entries(registry).reduce((acc, [key, value]) => {
      acc[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? ({ ...(value as FeatureFlagConfig) } as FeatureFlagConfig)
          : value;
      return acc;
    }, {} as FeatureFlagRegistry);
  }

  private async refreshCachedRegistry(
    options: FeatureFlagReaderInput = {},
    ...args: any[]
  ): Promise<FeatureFlagRegistry> {
    const envRegistry = await this.reader.read({
      ...options,
      source: options.source ?? FeatureFlagEnvironment,
    });
    let persisted: FeatureFlag[] = [];
    try {
      persisted = await this.repo.select().execute(...args);
    } catch {
      persisted = [];
    }

    const registry = this.cloneRegistry(envRegistry);
    for (const flag of persisted) {
      registry[flag.key] = flag.enabled ? (flag.config ?? true) : false;
    }
    return registry;
  }

  private setCachedFlag(flag: FeatureFlag): void {
    this.cachedRegistry[flag.key] = flag.enabled
      ? (flag.config ?? true)
      : false;
  }

  private getAccessRepository(): Repo<FeatureFlagAccess> {
    return this.accessRepository ?? Repository.forModel(FeatureFlagAccess);
  }

  private assertInitialized(): void {
    void this.reader;
  }

  private normalizeFeatureAccessInput(
    input: FeatureFlagAccessInput
  ): FeatureFlagAccessInput {
    return {
      ...input,
      featureKey: normalizeFeatureName(input.featureKey),
      subjectType: normalizeFeatureSubjectType(input.subjectType),
      subjectKey: normalizeFeatureSubjectKey(input.subjectKey),
    };
  }

  private buildAccessCondition(
    query: FeatureFlagAccessQuery
  ): Condition<FeatureFlagAccess> {
    let condition = Condition.attr<FeatureFlagAccess>("subjectType").eq(
      normalizeFeatureSubjectType(query.subjectType)
    );
    condition = condition.and(
      Condition.attr<FeatureFlagAccess>("subjectKey").eq(
        normalizeFeatureSubjectKey(query.subjectKey)
      )
    );
    if (typeof query.enabled !== "undefined") {
      condition = condition.and(
        Condition.attr<FeatureFlagAccess>("enabled").eq(query.enabled)
      );
    }
    if (query.featureKeys && query.featureKeys.length > 0) {
      condition = condition.and(
        Condition.attr<FeatureFlagAccess>("featureKey").in(
          query.featureKeys.map(normalizeFeatureName)
        )
      );
    }
    return condition;
  }

  override async create(
    model: FeatureFlag,
    ...args: any[]
  ): Promise<FeatureFlag> {
    model.key = normalizeFeatureName(model.key);
    model.enabled ??= true;
    const created = await super.create(model, ...args);
    this.setCachedFlag(created);
    return created;
  }

  override async update(
    model: FeatureFlag,
    ...args: any[]
  ): Promise<FeatureFlag> {
    model.key = normalizeFeatureName(model.key);
    model.enabled ??= true;
    const updated = await super.update(model, ...args);
    this.setCachedFlag(updated);
    return updated;
  }

  override async findOneBy(
    key: keyof FeatureFlag,
    value: any,
    ...args: any[]
  ): Promise<FeatureFlag> {
    const normalizedValue =
      key === "key" && typeof value === "string"
        ? normalizeFeatureName(value)
        : value;
    return this.repo.findOneBy(key, normalizedValue, ...args);
  }

  override async readAll(
    keys: any[],
    ...args: any[]
  ): Promise<FeatureFlag[]> {
    const result = await this.repo.readAll(keys, ...args);
    for (const flag of result) this.setCachedFlag(flag);
    return result;
  }

  async listEnabled(...args: any[]): Promise<FeatureFlag[]> {
    return this.repo
      .select()
      .where(Condition.attr<FeatureFlag>("enabled").eq(true))
      .execute(...args);
  }

  async grantFeatureAccess(
    input: FeatureFlagAccessInput,
    ...args: any[]
  ): Promise<FeatureFlagAccess> {
    const normalized = this.normalizeFeatureAccessInput(input);
    const existing = await this.findFeatureAccess(normalized, ...args).catch(
      () => undefined
    );
    if (!existing) {
      return this.getAccessRepository().create(
        new FeatureFlagAccess(normalized),
        ...args
      );
    }
    return this.getAccessRepository().update(
      Object.assign(existing, normalized),
      ...args
    );
  }

  async revokeFeatureAccess(
    input: FeatureFlagAccessSubject & { featureKey: string },
    ...args: any[]
  ): Promise<FeatureFlagAccess | undefined> {
    const existing = await this.findFeatureAccess(input, ...args).catch(
      () => undefined
    );
    if (!existing) return undefined;
    return this.getAccessRepository().delete(existing.id, ...args);
  }

  async findFeatureAccess(
    query: FeatureFlagAccessQuery,
    ...args: any[]
  ): Promise<FeatureFlagAccess> {
    const condition = this.buildAccessCondition(query);
    const results = await this.getAccessRepository()
      .select()
      .where(condition)
      .execute(...args);
    const existing = results[0];
    if (!existing) {
      throw new NotFoundError(
        `Feature access for ${normalizeFeatureSubjectType(query.subjectType)}:${normalizeFeatureSubjectKey(query.subjectKey)} not found`
      );
    }
    return existing;
  }

  async listFeatureAccess(
    query: FeatureFlagAccessQuery,
    ...args: any[]
  ): Promise<FeatureFlagAccess[]> {
    return this.getAccessRepository()
      .select()
      .where(this.buildAccessCondition(query))
      .execute(...args);
  }

  async resolveFeatureFlagsForSubject(
    subject: FeatureFlagAccessSubject,
    ...args: any[]
  ): Promise<FeatureFlagRegistry> {
    this.assertInitialized();
    const access = await this.listFeatureAccess(
      {
        ...subject,
        enabled: true,
      },
      ...args
    );
    const featureKeys = [...new Set(access.map((item) => item.featureKey))];
    if (featureKeys.length === 0) return {};

    const condition = Condition.attr<FeatureFlag>("enabled").eq(true).and(
      Condition.attr<FeatureFlag>("key").in(
        featureKeys.map(normalizeFeatureName)
      )
    );

    const enabledFlags = await this.repo.select().where(condition).execute(...args);
    return enabledFlags.reduce((registry, flag) => {
      registry[flag.key] = flag.config ?? true;
      return registry;
    }, {} as FeatureFlagRegistry);
  }

  async isEnabledForSubject(
    key: string,
    subject: FeatureFlagAccessSubject,
    ...args: any[]
  ): Promise<boolean> {
    const registry = await this.resolveFeatureFlagsForSubject(subject, ...args);
    return isFeatureFlagEnabledByName(registry, key);
  }

  isEnabled(key: string): boolean {
    this.assertInitialized();
    const normalizedKey = normalizeFeatureName(key);
    return isFeatureFlagEnabledByName(this.cachedRegistry, normalizedKey);
  }

  async resolveFeatureFlags(): Promise<FeatureFlagRegistry> {
    this.assertInitialized();
    return this.cloneRegistry(this.cachedRegistry);
  }

  async syncFromEnvironment(
    options: FeatureFlagReaderInput = {},
    ...args: any[]
  ): Promise<FeatureFlag[]> {
    this.assertInitialized();
    const registry = await this.reader.read({
      ...options,
      source: options.source ?? FeatureFlagEnvironment,
    });
    const results: FeatureFlag[] = [];
    for (const [key, value] of Object.entries(registry)) {
      const config =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as FeatureFlagConfig)
          : { enabled: Boolean(value) };
      const { enabled: _ignoredEnabled, ...restConfig } = config;
      const normalizedKey = normalizeFeatureName(key);
      const existing = await this.findOneBy(
        "key",
        normalizedKey,
        ...args
      ).catch(() => undefined);
      const model = existing
        ? Object.assign(existing, {
            enabled: isFeatureFlagEnabled(value),
            description: restConfig.description ?? existing.description,
            scope: restConfig.scope ?? existing.scope,
            metadata: restConfig.metadata ?? existing.metadata,
            config: {
              ...restConfig,
              enabled: isFeatureFlagEnabled(value),
            },
          })
        : new FeatureFlag({
            key: normalizedKey,
            enabled: isFeatureFlagEnabled(value),
            description: restConfig.description,
            scope: restConfig.scope,
            metadata: restConfig.metadata,
            config: {
              ...restConfig,
              enabled: isFeatureFlagEnabled(value),
            },
          });
      results.push(existing ? await this.update(model, ...args) : await this.create(model, ...args));
    }
    this.cachedRegistry = await this.refreshCachedRegistry(
      {
        ...options,
        source: options.source ?? FeatureFlagEnvironment,
      },
      ...args
    );
    return results;
  }
}
