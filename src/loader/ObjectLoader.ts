import { isAbsolute, resolve } from "path";
import { pathToFileURL } from "url";

import type {
  ObjectLoaderExportSelection,
  ObjectLoaderFamily,
  ObjectLoaderHook,
  ObjectLoaderHookContext,
  ObjectLoaderLoadOptions,
  ObjectLoaderOptions,
  ObjectLoaderSource,
} from "./types";

function isPathLikeSource(source: string): boolean {
  return (
    source.startsWith(".") ||
    source.startsWith("/") ||
    isAbsolute(source) ||
    /^[A-Za-z]:[\\/]/.test(source)
  );
}

/**
 * @module integrations/loader
 * @summary Dynamic TypeScript object loader utilities.
 * @description Base loader and concrete family loaders for dynamically
 * resolving Decaf integration objects without forcing callers to duplicate
 * import, selection, or post-load hook logic.
 */
export class ObjectLoader {
  public readonly family: ObjectLoaderFamily;

  public readonly defaultExportName: string;

  protected readonly hooks: readonly ObjectLoaderHook[];

  public constructor(options: ObjectLoaderOptions = {}) {
    this.family = options.family ?? "generic";
    this.defaultExportName = options.defaultExportName ?? "default";
    this.hooks = options.hooks ?? [];
  }

  protected normalizeSource(source: ObjectLoaderSource): string {
    if (source instanceof URL) {
      return source.href;
    }

    if (source.startsWith("file:") || source.startsWith("data:")) {
      return source;
    }

    if (isPathLikeSource(source)) {
      return pathToFileURL(resolve(source)).href;
    }

    return source;
  }

  protected async importModule(
    source: ObjectLoaderSource
  ): Promise<Readonly<Record<string, unknown>>> {
    const normalized = this.normalizeSource(source);
    return (await import(normalized)) as Readonly<Record<string, unknown>>;
  }

  protected resolveExport(
    module: Readonly<Record<string, unknown>>,
    exportName: string,
    source: string
  ): unknown {
    const exportedNames = Object.keys(module).filter(
      (key) => key !== "__esModule"
    );

    if (exportName === "default") {
      if ("default" in module) {
        return module.default;
      }

      if (exportedNames.length === 1) {
        return module[exportedNames[0]];
      }

      throw new Error(
        `Module "${source}" does not expose a default export.`
      );
    }

    if (!(exportName in module)) {
      throw new Error(`Module "${source}" does not export "${exportName}".`);
    }

    return module[exportName];
  }

  protected async applyHooks<T>(
    value: T,
    context: ObjectLoaderHookContext,
    hooks: readonly ObjectLoaderHook[]
  ): Promise<T> {
    let current = value;

    for (const hook of hooks) {
      const next = await hook(current, context);
      if (typeof next !== "undefined") {
        current = next as T;
      }
    }

    return current;
  }

  protected createInstance(options: ObjectLoaderOptions): this {
    const Loader = this.constructor as new (
      options?: ObjectLoaderOptions
    ) => ObjectLoader;
    return new Loader(options) as this;
  }

  public async loadModule(
    source: ObjectLoaderSource
  ): Promise<Readonly<Record<string, unknown>>> {
    return this.importModule(source);
  }

  public async loadExport<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    const normalizedSource = this.normalizeSource(source);
    const module = await this.importModule(normalizedSource);
    const resolved = this.resolveExport(module, exportName, normalizedSource);
    const hookContext: ObjectLoaderHookContext = {
      family: this.family,
      source: normalizedSource,
      exportName,
      module,
      loaderName: this.constructor.name,
    };

    const hooks = [...this.hooks, ...(options.hooks ?? [])];
    return this.applyHooks(resolved as T, hookContext, hooks);
  }

  public async loadDefault<T = unknown>(
    source: ObjectLoaderSource,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, this.defaultExportName, options);
  }

  public async load<T = unknown>(
    source: ObjectLoaderSource,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadDefault<T>(source, options);
  }

  public withHooks(...hooks: ObjectLoaderHook[]): this {
    return this.createInstance({
      family: this.family,
      defaultExportName: this.defaultExportName,
      hooks: [...this.hooks, ...hooks],
    });
  }

  public withOptions(options: Partial<ObjectLoaderOptions>): this {
    return this.createInstance({
      family: options.family ?? this.family,
      defaultExportName:
        options.defaultExportName ?? this.defaultExportName,
      hooks: [...this.hooks, ...(options.hooks ?? [])],
    });
  }
}

export function createLoaderHookContext(
  loader: ObjectLoader,
  module: Readonly<Record<string, unknown>>,
  source: string,
  exportName: string
): ObjectLoaderHookContext {
  return {
    family: loader.family,
    source,
    exportName,
    module,
    loaderName: loader.constructor.name,
  };
}

export type { ObjectLoaderExportSelection };
