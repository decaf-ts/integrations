/**
 * @module integrations/feature-flags/EngineCapabilityFeatureFlag.service
 * @summary Capability-derived feature-flag service (SAA-197, SAA-193 C22).
 * @description A {@link FeatureFlagService} subclass whose flag values are derived
 * exclusively from a served engine capability manifest — never from the
 * environment and never from the persistence repository. Resolution is
 * fail-closed: a feature that the manifest does not declare resolves to
 * `false`/absent, so an undeclared feature is denied rather than admitted.
 *
 * The input is the same manifest shape the as-graph server serves (per engine:
 * `engineId` plus `capabilities: [{ feature, verdict }]`), so no import of the
 * as-graph package is required and the dependency direction is preserved.
 */
import { service } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { FeatureFlag } from "./models/FeatureFlag.model";
import { FeatureFlagReader } from "./readers/FeatureFlagReader";
import {
  FeatureFlagService,
  type FeatureFlagServiceConfig,
} from "./services/FeatureFlag.service";
import type {
  FeatureFlagAccessSubject,
  FeatureFlagReaderInput,
  FeatureFlagRegistry,
} from "./types";
import {
  isFeatureFlagEnabled,
  isFeatureFlagEnabledByName,
  normalizeFeatureName,
} from "./utils";

/** The normalized per-feature verdict served in an engine capability manifest. */
export type EngineCapabilityFeatureVerdict =
  | "SUPPORTED"
  | "NOT_SUPPORTED"
  | "EXTENSION_POINT";

/** One engine entry of the manifest the flag registry is derived from. */
export interface EngineCapabilityFlagSource {
  /** Allowlisted engine id. */
  engineId: string;
  /** The engine's feature/verdict rows. */
  capabilities: ReadonlyArray<{
    feature: string;
    verdict: EngineCapabilityFeatureVerdict;
  }>;
}

/** The manifest subset the capability flag registry is derived from. */
export interface EngineCapabilityManifestInput {
  /** One entry per available engine. */
  engines: ReadonlyArray<EngineCapabilityFlagSource>;
  /** Engine id the server defaults to. */
  defaultEngineId?: string;
}

/** Pascal-cases a flag segment through the shared feature-name normalizer. */
function pascalSegment(value: string): string {
  const normalized = normalizeFeatureName(value);
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : normalized;
}

/**
 * Builds the canonical, collision-safe feature-flag key for an engine, or for one
 * feature of an engine. Keys are `engine<Pascal(engineId)>` and
 * `engine<Pascal(engineId)><Pascal(feature)>`; use this helper rather than
 * assembling keys by hand.
 *
 * @param engineId - The engine id.
 * @param feature - The feature name, when a feature key is wanted.
 * @returns The canonical flag key.
 */
export function engineCapabilityFlagKey(
  engineId: string,
  feature?: string
): string {
  const engine = pascalSegment(engineId);
  return feature === undefined
    ? `engine${engine}`
    : `engine${engine}${pascalSegment(feature)}`;
}

/**
 * Derives a fail-closed feature-flag registry from an engine capability manifest:
 * an engine key is enabled, and a feature key is enabled **only** when the engine
 * declares that feature `SUPPORTED`. Features declared `NOT_SUPPORTED` or
 * `EXTENSION_POINT`, and features absent from the manifest, are all disabled.
 *
 * @param manifest - The served engine capability manifest.
 * @returns The derived flag registry.
 */
export function engineCapabilityFlagRegistry(
  manifest: EngineCapabilityManifestInput
): FeatureFlagRegistry {
  const registry: FeatureFlagRegistry = {};
  for (const engine of manifest.engines ?? []) {
    registry[engineCapabilityFlagKey(engine.engineId)] = true;
    for (const capability of engine.capabilities ?? []) {
      registry[engineCapabilityFlagKey(engine.engineId, capability.feature)] =
        capability.verdict === "SUPPORTED";
    }
  }
  return registry;
}

/**
 * A {@link FeatureFlagReader} over an already-derived capability registry. It
 * never reads the environment; {@link FeatureFlagReader.read} returns a copy of the
 * capability registry so the base service's reader plumbing stays satisfied.
 */
class EngineCapabilityFlagReader extends FeatureFlagReader {
  /**
   * @param registry - The capability-derived flag registry.
   */
  constructor(private readonly registry: FeatureFlagRegistry) {
    super();
  }

  /** Returns a copy of the capability registry, ignoring any reader input. */
  async read(input?: FeatureFlagReaderInput): Promise<FeatureFlagRegistry> {
    void input;
    return { ...this.registry };
  }
}

/** Configuration for {@link EngineCapabilityFeatureFlagService}. */
export interface EngineCapabilityFeatureFlagServiceConfig
  extends FeatureFlagServiceConfig {
  /**
   * The served engine capability manifest the flag values are derived from.
   * When omitted the registry is empty, so every feature resolves denied
   * (fail-closed).
   */
  manifest?: EngineCapabilityManifestInput;
}

/**
 * A {@link FeatureFlagService} whose values come from the served engine
 * capability manifest. Every read path (`isEnabled`, `resolveFeatureFlags`,
 * `isEnabledForSubject`, `resolveFeatureFlagsForSubject`) resolves against the
 * derived registry only; a feature the manifest does not declare is denied.
 * `syncFromEnvironment` is overridden to fail closed rather than read the
 * environment.
 *
 * Carries its own `@service()` decorator: the parent {@link FeatureFlagService}
 * is itself `@service(...)`-decorated, so without a decorator of its own the
 * parent constructor's singleton wrapper would be returned and the capability
 * methods below would be unreachable. Decorating the leaf subclass restores it;
 * the subclass does not rely on the parent's environment/repository fields.
 *
 * The constructor additionally re-parents the constructed instance when the parent's
 * singleton wrapper has already cached a `FeatureFlagService` (which would otherwise
 * be returned through `super()`), so the capability methods stay reachable on every
 * construction.
 */
@service()
export class EngineCapabilityFeatureFlagService extends FeatureFlagService {
  constructor() {
    const base = super() as unknown as object;
    if (!(this instanceof EngineCapabilityFeatureFlagService)) {
      return Object.assign(
        Object.create(EngineCapabilityFeatureFlagService.prototype),
        base,
        { capabilityRegistry: {} }
      );
    }
    this.capabilityRegistry = {};
  }

  private capabilityRegistry!: FeatureFlagRegistry;

  /**
   * Initializes the service from its manifest, replacing the base service's
   * environment/repository-backed registry with the capability-derived one. No
   * environment source is read.
   */
  async initialize(...args: any[]): Promise<{
    config: EngineCapabilityFeatureFlagServiceConfig;
    client: FeatureFlagReader;
  }> {
    const config =
      (args[0] as EngineCapabilityFeatureFlagServiceConfig | undefined) ?? {};
    if (config.repository) {
      this._repository = config.repository as any;
    }
    this.capabilityRegistry = engineCapabilityFlagRegistry(
      config.manifest ?? { engines: [] }
    );
    const reader = new EngineCapabilityFlagReader(this.capabilityRegistry);
    const effectiveConfig: EngineCapabilityFeatureFlagServiceConfig = {
      ...config,
      reader,
      readerConfig: { ...(config.readerConfig ?? {}), source: {} },
    };
    return { config: effectiveConfig, client: reader };
  }

  /**
   * Whether an engine is available in the manifest.
   *
   * @param engineId - The engine id to check.
   * @returns `true` when the engine is declared.
   */
  isEngineEnabled(engineId: string): boolean {
    return isFeatureFlagEnabledByName(
      this.capabilityRegistry,
      engineCapabilityFlagKey(engineId)
    );
  }

  /**
   * Whether an engine declares a feature as `SUPPORTED`. An undeclared feature,
   * or one declared `NOT_SUPPORTED`/`EXTENSION_POINT`, resolves `false`.
   *
   * @param engineId - The engine id to check.
   * @param feature - The feature name to check.
   * @returns `true` only when the manifest declares the feature `SUPPORTED`.
   */
  isEngineFeatureEnabled(engineId: string, feature: string): boolean {
    return isFeatureFlagEnabledByName(
      this.capabilityRegistry,
      engineCapabilityFlagKey(engineId, feature)
    );
  }

  /** Resolves a flag from the capability registry; undeclared keys are denied. */
  override isEnabled(key: string): boolean {
    return isFeatureFlagEnabledByName(this.capabilityRegistry, key);
  }

  /** Returns a copy of the capability-derived registry. */
  override async resolveFeatureFlags(): Promise<FeatureFlagRegistry> {
    return { ...this.capabilityRegistry };
  }

  /** Returns a copy of the capability-derived registry (not subject-scoped). */
  override async resolveFeatureFlagsForSubject(
    subject: FeatureFlagAccessSubject,
    ...args: any[]
  ): Promise<FeatureFlagRegistry> {
    void subject;
    void args;
    return { ...this.capabilityRegistry };
  }

  /** Resolves a flag from the capability registry; undeclared keys are denied. */
  override async isEnabledForSubject(
    key: string,
    subject: FeatureFlagAccessSubject,
    ...args: any[]
  ): Promise<boolean> {
    void subject;
    void args;
    return isFeatureFlagEnabledByName(this.capabilityRegistry, key);
  }

  /** Lists the enabled capability flags as models, without touching a repository. */
  override async listEnabled(...args: any[]): Promise<FeatureFlag[]> {
    void args;
    return Object.entries(this.capabilityRegistry)
      .filter(([, value]) => isFeatureFlagEnabled(value))
      .map(
        ([key]) =>
          new FeatureFlag({
            key,
            enabled: true,
            config: { enabled: true },
          })
      );
  }

  /**
   * Fails closed: capability flags are derived from the served engine manifest
   * and are never synced from the environment.
   */
  override async syncFromEnvironment(...args: any[]): Promise<FeatureFlag[]> {
    void args;
    throw new InternalError(
      "Engine capability feature flags are derived from the served engine manifest and are never synced from the environment"
    );
  }
}
