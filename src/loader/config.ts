import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UnsupportedError } from "@decaf-ts/core";
import { ConflictError, NotFoundError } from "@decaf-ts/db-decorators";

import { ObjectLoader } from "./ObjectLoader";
import type {
  ObjectLoaderLoadOptions,
  ObjectLoaderOptions,
  ObjectLoaderSource,
} from "./types";

const YAML_SPECIFIER = "yaml";

export type ConfigFormat = "auto" | "json" | "yaml" | "module";

export type ConfigSource =
  | ObjectLoaderSource
  | Readonly<Record<string, unknown>>;

/**
 * @summary Minimal global config registry.
 * @description A process-wide key/value store that concrete loaders register
 * loaded configuration into. It is intentionally small: register a value under a
 * key, read it back, list it, snapshot it, and optionally freeze it once boot
 * configuration is complete.
 *
 * `GlobalConfigRegistry.reset()` clears the contents but keeps the singleton
 * instance, so a `globalConfig` reference captured at import time stays valid.
 */
export class GlobalConfigRegistry {
  private static current: GlobalConfigRegistry | undefined;

  private readonly store = new Map<string, unknown>();

  private frozen = false;

  public static get instance(): GlobalConfigRegistry {
    if (!GlobalConfigRegistry.current) {
      GlobalConfigRegistry.current = new GlobalConfigRegistry();
    }
    return GlobalConfigRegistry.current;
  }

  public static reset(): void {
    if (GlobalConfigRegistry.current) {
      GlobalConfigRegistry.current.clear();
    }
  }

  public register(
    key: string,
    value: unknown,
    options: { override?: boolean } = {}
  ): this {
    if (this.frozen) {
      throw new UnsupportedError(
        `The global config registry is frozen; cannot register key "${key}".`
      );
    }
    if (this.store.has(key) && !options.override) {
      throw new ConflictError(
        `Global config key "${key}" is already registered. Pass override: true to replace it.`
      );
    }
    this.store.set(key, value);
    return this;
  }

  public get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  public require<T = unknown>(key: string): T {
    if (!this.store.has(key)) {
      throw new NotFoundError(`Global config key "${key}" is not registered.`);
    }
    return this.store.get(key) as T;
  }

  public has(key: string): boolean {
    return this.store.has(key);
  }

  public keys(): string[] {
    return [...this.store.keys()];
  }

  public entries(): [string, unknown][] {
    return [...this.store.entries()];
  }

  public snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(this.store));
  }

  public clear(): void {
    this.store.clear();
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public get isFrozen(): boolean {
    return this.frozen;
  }
}

/** Process-wide config registry used by default. */
export const globalConfig: GlobalConfigRegistry = GlobalConfigRegistry.instance;

export interface ConfigObjectLoaderOptions extends ObjectLoaderOptions {
  /** Registry to register into. Defaults to {@link globalConfig}. */
  readonly registry?: GlobalConfigRegistry;
}

export interface ConfigLoadOptions extends ObjectLoaderLoadOptions {
  /** Explicit registry key. Defaults to the derived source name. */
  readonly key?: string;
  /** Optional namespace prefix for the derived registry key. */
  readonly namespace?: string;
  /** Replace an existing key instead of failing with a conflict. */
  readonly override?: boolean;
  /** Source format. `"auto"` detects from the source extension. */
  readonly format?: ConfigFormat;
  /** Registry to register into. Defaults to the loader registry. */
  readonly registry?: GlobalConfigRegistry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof URL)
  );
}

function isSourceLike(source: ConfigSource): source is ObjectLoaderSource {
  return typeof source === "string" || source instanceof URL;
}

/**
 * @summary Load config sources into the global config registry.
 * @description Supports inline objects, `.json` files, optional `.yaml`/`.yml`
 * files, and JS/TS modules. Loaded configs run through the shared hook
 * pipeline, then register under a key so the rest of the system can read them
 * from {@link globalConfig}.
 */
export class ConfigObjectLoader extends ObjectLoader {
  public readonly registry: GlobalConfigRegistry;

  public constructor(options: ConfigObjectLoaderOptions = {}) {
    super({ ...options, family: "config" });
    this.registry = options.registry ?? globalConfig;
  }

  protected override createInstance(options: ObjectLoaderOptions): this {
    return new ConfigObjectLoader({
      ...options,
      registry: this.registry,
    }) as this;
  }

  /**
   * @summary Load a config source, run hooks, and register it globally.
   */
  public async loadConfig<T = Readonly<Record<string, unknown>>>(
    source: ConfigSource,
    options: ConfigLoadOptions = {}
  ): Promise<T> {
    const {
      key,
      namespace,
      override,
      format = "auto",
      registry = this.registry,
      ...loadOptions
    } = options;
    const value = await this.readConfig<T>(source, format);
    const resolvedKey = key ?? this.deriveKey(source, namespace);
    const context = this.createContext(
      this.describeSource(source),
      resolvedKey,
      isPlainObject(value) ? value : {},
      "afterResolve",
      {
        ...this.metadata,
        ...(options.metadata ?? {}),
        key: resolvedKey,
        namespace,
      }
    );
    const processed = await this.runHooks<T>(value, context, loadOptions);
    registry.register(resolvedKey, processed, { override });
    return processed;
  }

  /**
   * @summary Alias for {@link ConfigObjectLoader.loadConfig}.
   */
  public async loadAndRegister<T = Readonly<Record<string, unknown>>>(
    source: ConfigSource,
    options: ConfigLoadOptions = {}
  ): Promise<T> {
    return this.loadConfig<T>(source, options);
  }

  public register(
    key: string,
    value: unknown,
    options: { override?: boolean; registry?: GlobalConfigRegistry } = {}
  ): this {
    const registry = options.registry ?? this.registry;
    registry.register(key, value, { override: options.override });
    return this;
  }

  public get<T = unknown>(key: string): T | undefined {
    return this.registry.get<T>(key);
  }

  protected async readConfig<T>(
    source: ConfigSource,
    format: ConfigFormat
  ): Promise<T> {
    if (isPlainObject(source)) {
      return source as T;
    }
    const normalized = this.normalizeSource(source);
    const resolvedFormat =
      format === "auto" ? this.detectFormat(normalized) : format;
    if (resolvedFormat === "json") {
      return JSON.parse(await this.readText(normalized)) as T;
    }
    if (resolvedFormat === "yaml") {
      const yaml = await this.loadYaml();
      return yaml.parse(await this.readText(normalized)) as T;
    }
    const module = await this.importModule(normalized);
    return this.resolveExport(module, this.defaultExportName, normalized) as T;
  }

  protected detectFormat(source: string): Exclude<ConfigFormat, "auto"> {
    const path = source.split("?")[0].toLowerCase();
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
    return "module";
  }

  protected async readText(source: string): Promise<string> {
    if (/^https?:\/\//i.test(source)) {
      if (typeof fetch !== "function") {
        throw new UnsupportedError(
          `Remote config source "${source}" requires a global fetch implementation.`
        );
      }
      const response = await fetch(source);
      if (!response.ok) {
        throw new UnsupportedError(
          `Remote config source "${source}" responded with ${response.status}.`
        );
      }
      return response.text();
    }
    const path = source.startsWith("file:")
      ? fileURLToPath(source)
      : isAbsolute(source)
        ? source
        : resolve(source);
    return readFile(path, "utf8");
  }

  protected async loadYaml(): Promise<{
    parse(input: string): unknown;
  }> {
    try {
      return (await import(/* @vite-ignore */ YAML_SPECIFIER)) as {
        parse(input: string): unknown;
      };
    } catch (error) {
      throw new UnsupportedError(
        `YAML config sources require the optional "yaml" package. ` +
          `Install "yaml" or provide JSON/module config sources instead. ` +
          `Cause: ${(error as Error)?.message ?? String(error)}`
      );
    }
  }

  protected deriveKey(source: ConfigSource, namespace?: string): string {
    const name = isSourceLike(source)
      ? basename(this.describeSource(source)).replace(/\.[^.]+$/, "")
      : "config";
    return namespace ? `${namespace}:${name}` : name;
  }

  protected describeSource(source: ConfigSource): string {
    if (source instanceof URL) return source.href;
    if (typeof source === "string") return this.normalizeSource(source);
    return "<inline>";
  }
}
