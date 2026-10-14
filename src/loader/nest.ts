import { UnsupportedError } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import type { Constructor } from "@decaf-ts/decoration";

import { ObjectLoader } from "./ObjectLoader";
import type {
  ObjectLoaderLoadOptions,
  ObjectLoaderOptions,
  ObjectLoaderSource,
} from "./types";

/**
 * @module integrations/loader/nest
 * @summary Lazy NestJS loaders.
 * @description Resolves NestJS controller classes and their route definitions
 * from dynamically loaded modules. `@nestjs/common` and `reflect-metadata` are
 * optional at runtime: both are dynamically imported/checked and the loaders
 * degrade with a decaf {@link UnsupportedError} when they are unavailable.
 *
 * ## Tree-shaking
 * The NestJS runtime is imported through a non-literal specifier so bundlers keep
 * it as a runtime import and never inline it into the loader chunk. Nest
 * applications already keep `@nestjs/common` in their entry graph, so the loader
 * does not need a static reference of its own.
 */

/**
 * Stable NestJS metadata keys. Declared as literals so this module never
 * hard-depends on `@nestjs/common/constants` (a CommonJS-only subpath).
 */
export const NEST_PATH_METADATA = "path";
export const NEST_METHOD_METADATA = "method";
export const NEST_CONTROLLER_WATERMARK = "__controller__";
export const NEST_MODULE_CONTROLLERS = "controllers";
export const NEST_MODULE_IMPORTS = "imports";

const NEST_COMMON_SPECIFIER = "@nestjs/common";

const HTTP_METHOD_NAMES: Record<number, string> = {
  0: "GET",
  1: "POST",
  2: "PUT",
  3: "DELETE",
  4: "PATCH",
  5: "ALL",
  6: "OPTIONS",
  7: "HEAD",
  8: "SEARCH",
  9: "PROPFIND",
  10: "PROPPATCH",
  11: "MKCOL",
  12: "COPY",
  13: "MOVE",
  14: "LOCK",
  15: "UNLOCK",
  16: "QUERY",
};

interface MetadataReader {
  getMetadata(key: string, target: object): unknown;
}

let nestCommonPromise: Promise<Readonly<Record<string, unknown>>> | undefined;

/**
 * @summary Lazily resolve the NestJS runtime.
 * @description Uses a non-literal dynamic import so bundlers do not inline or
 * drop `@nestjs/common`. Throws a decaf {@link UnsupportedError} when the
 * package cannot be resolved.
 */
export async function loadNestCommon(): Promise<
  Readonly<Record<string, unknown>>
> {
  if (!nestCommonPromise) {
    nestCommonPromise = import(/* @vite-ignore */ NEST_COMMON_SPECIFIER)
      .then((module) => {
        const resolved = module as Readonly<Record<string, unknown>>;
        if (typeof resolved.Controller !== "function") {
          throw new UnsupportedError(
            `NestJS integration is not available: "${NEST_COMMON_SPECIFIER}" does not expose the expected exports.`
          );
        }
        return resolved;
      })
      .catch((error: unknown) => {
        nestCommonPromise = undefined;
        if (error instanceof UnsupportedError) throw error;
        throw new UnsupportedError(
          `NestJS integration is not available: "${NEST_COMMON_SPECIFIER}" could not be resolved. ` +
            `Install @nestjs/common and reflect-metadata to use the Nest loaders. ` +
            `Cause: ${(error as Error)?.message ?? String(error)}`
        );
      });
  }
  return nestCommonPromise;
}

function metadataReader(): MetadataReader {
  const reflect = Reflect as unknown as Partial<MetadataReader>;
  if (typeof reflect.getMetadata !== "function") {
    throw new UnsupportedError(
      "NestJS metadata is not available: reflect-metadata must be loaded before using the Nest loaders."
    );
  }
  return reflect as MetadataReader;
}

function methodNameFor(method: number): string {
  return HTTP_METHOD_NAMES[method] ?? `METHOD_${method}`;
}

function normalizeSegment(segment: string): string {
  return segment.replace(/^\/+|\/+$/g, "");
}

function joinRoutePaths(controllerPath?: string, routePath?: string): string {
  const segments = [controllerPath, routePath]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeSegment)
    .filter(Boolean);
  return `/${segments.join("/")}`;
}

/**
 * A route definition resolved from a NestJS controller.
 */
export interface NestRouteDefinition {
  /** Controller class that owns the handler. */
  readonly controller: Constructor;
  readonly controllerName: string;
  readonly controllerPath?: string;
  readonly propertyKey: string | symbol;
  readonly handler: (...args: unknown[]) => unknown;
  /** Numeric NestJS `RequestMethod` value. */
  readonly method: number;
  /** Human readable HTTP method name. */
  readonly methodName: string;
  /** Route path relative to the controller path. */
  readonly path: string;
  /** Controller path joined with the route path. */
  readonly fullPath: string;
}

export interface NestControllerLoadOptions extends ObjectLoaderLoadOptions {
  /** When true, `loadControllers` scans the module namespace recursively. */
  readonly recursive?: boolean;
}

/**
 * @summary Resolve NestJS controller classes from dynamically loaded modules.
 * @description Extends the generic controller family with NestJS metadata
 * awareness. Requires `@nestjs/common` and `reflect-metadata` at runtime.
 */
export class NestControllerObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "controller" });
  }

  public async loadController<T extends Constructor = Constructor>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    await loadNestCommon();
    const value = await this.loadExport<unknown>(source, exportName, options);
    return this.assertController<T>(
      value,
      this.normalizeSource(source),
      exportName
    );
  }

  /**
   * @summary Load every controller exported by a module.
   */
  public async loadControllers<T extends Constructor = Constructor>(
    source: ObjectLoaderSource,
    options: NestControllerLoadOptions = {}
  ): Promise<T[]> {
    await loadNestCommon();
    const module = await this.loadModule(source);
    const controllers = this.collectControllers<T>(module, options.recursive);
    const context = this.createContext(
      this.normalizeSource(source),
      "*",
      module,
      "afterResolve",
      {
        ...this.metadata,
        ...(options.metadata ?? {}),
        controllerCount: controllers.length,
      }
    );
    return this.runHooks(controllers, context, options);
  }

  /**
   * @summary Scan a NestJS module (or namespace) for controller classes.
   * @description Synchronous metadata scan. Requires `reflect-metadata` but not
   * `@nestjs/common`; call {@link loadNestCommon} first when the module must be
   * imported.
   */
  public collectControllers<T extends Constructor = Constructor>(
    value: unknown,
    recursive = true
  ): T[] {
    const result: T[] = [];
    const seen = new Set<unknown>();
    this.scanControllers(value, result, seen, recursive);
    return result;
  }

  public isController(value: unknown): value is Constructor {
    if (typeof value !== "function") return false;
    const reader = metadataReader();
    return (
      reader.getMetadata(NEST_CONTROLLER_WATERMARK, value) === true ||
      typeof reader.getMetadata(NEST_PATH_METADATA, value) !== "undefined"
    );
  }

  public getControllerPath(controller: Constructor): string | undefined {
    const value = metadataReader().getMetadata(NEST_PATH_METADATA, controller);
    return typeof value === "string" ? value : undefined;
  }

  protected assertController<T extends Constructor = Constructor>(
    value: unknown,
    source: string,
    exportName: string
  ): T {
    if (!this.isController(value)) {
      throw new ValidationError(
        `Loaded controller export "${exportName}" from "${source}" is not a NestJS controller.`
      );
    }
    return value as T;
  }

  protected scanControllers<T extends Constructor = Constructor>(
    value: unknown,
    result: T[],
    seen: Set<unknown>,
    recursive: boolean
  ): void {
    if (value === null || typeof value !== "object") {
      if (this.isController(value) && !result.includes(value as T)) {
        result.push(value as T);
      }
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);

    const record = value as Record<string | symbol, unknown>;
    const controllers = record[NEST_MODULE_CONTROLLERS];
    if (Array.isArray(controllers)) {
      for (const controller of controllers) {
        if (
          this.isController(controller) &&
          !result.includes(controller as T)
        ) {
          result.push(controller as T);
        }
      }
    }

    if (recursive) {
      const imports = record[NEST_MODULE_IMPORTS];
      if (Array.isArray(imports)) {
        for (const imported of imports) {
          if (
            imported &&
            typeof (imported as Promise<unknown>).then === "function"
          ) {
            continue;
          }
          this.scanControllers(imported, result, seen, recursive);
        }
      }
    }

    for (const key of Object.keys(record)) {
      const candidate = record[key];
      if (this.isController(candidate) && !result.includes(candidate as T)) {
        result.push(candidate as T);
      }
    }
  }
}

/**
 * @summary Resolve route definitions from dynamically loaded NestJS modules.
 */
export class NestRouteObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "route" });
  }

  /**
   * @summary Load every route declared by a controller exported from a module.
   */
  public async loadControllerRoutes(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<NestRouteDefinition[]> {
    await loadNestCommon();
    const value = await this.loadExport<unknown>(source, exportName, options);
    const controller = this.assertController(
      value,
      this.normalizeSource(source),
      exportName
    );
    const routes = this.getRoutes(controller);
    const context = this.createContext(
      this.normalizeSource(source),
      exportName,
      {},
      "afterResolve",
      {
        ...this.metadata,
        ...(options.metadata ?? {}),
        routeCount: routes.length,
      }
    );
    return this.runHooks(routes, context, options);
  }

  /**
   * @summary Load every route declared by every controller in a module.
   */
  public async loadRoutes(
    source: ObjectLoaderSource,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<NestRouteDefinition[]> {
    await loadNestCommon();
    const module = await this.loadModule(source);
    const controllerLoader = new NestControllerObjectLoader({
      hooks: this.hooks,
      beforeResolveHooks: this.beforeResolveHooks,
    });
    const controllers = controllerLoader.collectControllers(module);
    const routes: NestRouteDefinition[] = [];
    for (const controller of controllers) {
      routes.push(...this.getRoutes(controller));
    }
    const context = this.createContext(
      this.normalizeSource(source),
      "*",
      module,
      "afterResolve",
      {
        ...this.metadata,
        ...(options.metadata ?? {}),
        routeCount: routes.length,
      }
    );
    return this.runHooks(routes, context, options);
  }

  /**
   * @summary Extract route definitions from a controller class.
   * @description Synchronous metadata scan. Requires `reflect-metadata`.
   */
  public getRoutes(
    controller: Constructor,
    controllerPath?: string
  ): NestRouteDefinition[] {
    const reader = metadataReader();
    const resolvedControllerPath =
      controllerPath ?? this.getControllerPath(controller);
    const prototype = controller.prototype as Record<string | symbol, unknown>;
    const keys: (string | symbol)[] = [
      ...Object.getOwnPropertyNames(prototype),
      ...Object.getOwnPropertySymbols(prototype),
    ];
    const routes: NestRouteDefinition[] = [];
    for (const propertyKey of keys) {
      if (propertyKey === "constructor") continue;
      const handler = prototype[propertyKey];
      if (typeof handler !== "function") continue;
      const method = reader.getMetadata(NEST_METHOD_METADATA, handler);
      if (typeof method !== "number") continue;
      const routePath = reader.getMetadata(NEST_PATH_METADATA, handler);
      const path = typeof routePath === "string" ? routePath : "";
      routes.push({
        controller,
        controllerName: controller.name,
        controllerPath: resolvedControllerPath || undefined,
        propertyKey,
        handler: handler as (...args: unknown[]) => unknown,
        method,
        methodName: methodNameFor(method),
        path,
        fullPath: joinRoutePaths(resolvedControllerPath, path),
      });
    }
    return routes;
  }

  public isController(value: unknown): value is Constructor {
    if (typeof value !== "function") return false;
    const reader = metadataReader();
    return (
      reader.getMetadata(NEST_CONTROLLER_WATERMARK, value) === true ||
      typeof reader.getMetadata(NEST_PATH_METADATA, value) !== "undefined"
    );
  }

  public getControllerPath(controller: Constructor): string | undefined {
    const value = metadataReader().getMetadata(NEST_PATH_METADATA, controller);
    return typeof value === "string" ? value : undefined;
  }

  protected assertController(
    value: unknown,
    source: string,
    exportName: string
  ): Constructor {
    if (!this.isController(value)) {
      throw new ValidationError(
        `Loaded controller export "${exportName}" from "${source}" is not a NestJS controller.`
      );
    }
    return value;
  }
}
