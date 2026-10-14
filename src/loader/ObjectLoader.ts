import { isAbsolute, resolve } from "path";
import { pathToFileURL } from "url";

import type {
  ObjectLoaderExportSelection,
  ObjectLoaderFamily,
  ObjectLoaderHook,
  ObjectLoaderHookContext,
  ObjectLoaderHookPhase,
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
 *
 * ## Tree-shaking / build-time references
 *
 * Dynamic imports are resolved at runtime, so a bundler cannot see which modules
 * are actually reachable and may drop them from the output. To keep a module
 * available, keep a *static* reference to it somewhere in the entry graph (for
 * example a `loaderManifest` object or a side-effect import) while the runtime
 * lookup still goes through {@link ObjectLoader.loadModule}. Prefer passing the
 * specifier as a variable (`import(specifier)`) instead of a string literal:
 * bundlers leave non-literal dynamic imports untouched, which preserves the
 * lazy/runtime semantics. See {@link moduleReference} for a small helper that
 * encodes this pattern.
 */
export class ObjectLoader {
  public readonly family: ObjectLoaderFamily;

  public readonly defaultExportName: string;

  protected readonly hooks: readonly ObjectLoaderHook[];

  protected readonly beforeResolveHooks: readonly ObjectLoaderHook[];

  protected readonly metadata: Readonly<Record<string, unknown>>;

  public constructor(options: ObjectLoaderOptions = {}) {
    this.family = options.family ?? "generic";
    this.defaultExportName = options.defaultExportName ?? "default";
    this.hooks = options.hooks ?? [];
    this.beforeResolveHooks = options.beforeResolveHooks ?? [];
    this.metadata = options.metadata ?? {};
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

      // Pre-existing raw Error kept for backward compatibility. New code paths
      // must throw a decaf error hierarchy subclass instead.
      throw new Error(`Module "${source}" does not expose a default export.`);
    }

    if (!(exportName in module)) {
      // Pre-existing raw Error kept for backward compatibility. New code paths
      // must throw a decaf error hierarchy subclass instead.
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

  /**
   * @summary Build the hook context for a load operation.
   * @description Concrete loaders call this to build a context that carries the
   * load phase and any loader-specific metadata into hooks.
   */
  protected createContext(
    source: string,
    exportName: string,
    module: Readonly<Record<string, unknown>>,
    phase: ObjectLoaderHookPhase,
    metadata: Readonly<Record<string, unknown>> = this.metadata
  ): ObjectLoaderHookContext {
    return {
      family: this.family,
      source,
      exportName,
      module,
      loaderName: this.constructor.name,
      phase,
      metadata,
    };
  }

  /**
   * @summary Run the configured export hooks against a value.
   * @description Exposed to concrete loaders that load content (assets, configs)
   * instead of importing a module, so they can reuse the same hook pipeline.
   */
  protected async runHooks<T>(
    value: T,
    context: ObjectLoaderHookContext,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    const hooks = [...this.hooks, ...(options.hooks ?? [])];
    return this.applyHooks(value, context, hooks);
  }

  /**
   * @summary Run the configured pre-resolve hooks against a module namespace.
   */
  protected async runBeforeResolveHooks(
    module: Readonly<Record<string, unknown>>,
    context: ObjectLoaderHookContext,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<Readonly<Record<string, unknown>>> {
    const hooks = [
      ...this.beforeResolveHooks,
      ...(options.beforeResolveHooks ?? []),
    ];
    if (!hooks.length) return module;
    return this.applyHooks(module, context, hooks);
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
    const imported = await this.importModule(normalizedSource);
    const beforeResolveContext = this.createContext(
      normalizedSource,
      exportName,
      imported,
      "beforeResolve",
      options.metadata ?? this.metadata
    );
    const module = await this.runBeforeResolveHooks(
      imported,
      beforeResolveContext,
      options
    );
    const resolved = this.resolveExport(module, exportName, normalizedSource);
    const afterResolveContext = this.createContext(
      normalizedSource,
      exportName,
      module,
      "afterResolve",
      options.metadata ?? this.metadata
    );

    return this.runHooks(resolved as T, afterResolveContext, options);
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
      beforeResolveHooks: [...this.beforeResolveHooks],
      metadata: this.metadata,
    });
  }

  public withBeforeResolveHooks(...hooks: ObjectLoaderHook[]): this {
    return this.createInstance({
      family: this.family,
      defaultExportName: this.defaultExportName,
      hooks: [...this.hooks],
      beforeResolveHooks: [...this.beforeResolveHooks, ...hooks],
      metadata: this.metadata,
    });
  }

  public withOptions(options: Partial<ObjectLoaderOptions>): this {
    return this.createInstance({
      family: options.family ?? this.family,
      defaultExportName: options.defaultExportName ?? this.defaultExportName,
      hooks: [...this.hooks, ...(options.hooks ?? [])],
      beforeResolveHooks: [
        ...this.beforeResolveHooks,
        ...(options.beforeResolveHooks ?? []),
      ],
      metadata: { ...this.metadata, ...(options.metadata ?? {}) },
    });
  }
}

export function createLoaderHookContext(
  loader: ObjectLoader,
  module: Readonly<Record<string, unknown>>,
  source: string,
  exportName: string,
  phase: ObjectLoaderHookPhase = "afterResolve",
  metadata: Readonly<Record<string, unknown>> = {}
): ObjectLoaderHookContext {
  return {
    family: loader.family,
    source,
    exportName,
    module,
    loaderName: loader.constructor.name,
    phase,
    metadata,
  };
}

/**
 * @summary Build a lazy module reference that survives bundling.
 * @description Pass a *variable* specifier to `import()` so bundlers do not
 * statically inline or drop the target. Pair it with a static reference in your
 * entry graph when the module must be retained:
 *
 * ```ts
 * export const loaderManifest = { feature: "./feature/index.js" } as const;
 * const reference = moduleReference(loaderManifest.feature);
 * const module = await reference();
 * ```
 */
export function moduleReference(
  specifier: string
): () => Promise<Readonly<Record<string, unknown>>> {
  return () =>
    import(/* @vite-ignore */ specifier) as Promise<
      Readonly<Record<string, unknown>>
    >;
}

export type { ObjectLoaderExportSelection };
