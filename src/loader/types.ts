import type { Constructor } from "@decaf-ts/decoration";

export type ObjectLoaderFamily =
  | "generic"
  | "model"
  | "adapter"
  | "repository"
  | "service"
  | "controller"
  | "environment"
  | "component"
  | "node"
  | "asset"
  | "route"
  | "config";

export type ObjectLoaderSource = string | URL;

export type MaybePromise<T> = T | Promise<T>;

/**
 * @summary Load lifecycle phase a hook is invoked in.
 * @description The base loader runs `beforeResolve` hooks against the imported
 * module namespace and `afterResolve` hooks against the selected export. The phase
 * is optional on the context for backward compatibility, but the base loader always
 * populates it.
 */
export type ObjectLoaderHookPhase = "beforeResolve" | "afterResolve";

export interface ObjectLoaderHookContext {
  readonly family: ObjectLoaderFamily;
  readonly source: string;
  readonly exportName: string;
  readonly module: Readonly<Record<string, unknown>>;
  readonly loaderName: string;
  /**
   * The phase this hook runs in. `beforeResolve` hooks receive the imported
   * module namespace, `afterResolve` hooks receive the resolved export.
   */
  readonly phase?: ObjectLoaderHookPhase;
  /**
   * Free-form metadata a concrete loader attaches for its hooks (asset format,
   * config key, controller count, ...).
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ObjectLoaderHook = (
  value: unknown,
  context: ObjectLoaderHookContext
) => MaybePromise<unknown | void>;

export interface ObjectLoaderOptions {
  readonly family?: ObjectLoaderFamily;
  /** Hooks run against the resolved export (backward compatible default). */
  readonly hooks?: readonly ObjectLoaderHook[];
  /** Hooks run against the imported module namespace before export selection. */
  readonly beforeResolveHooks?: readonly ObjectLoaderHook[];
  readonly defaultExportName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ObjectLoaderLoadOptions {
  /** Per-call hooks run against the resolved export. */
  readonly hooks?: readonly ObjectLoaderHook[];
  /** Per-call hooks run against the imported module namespace. */
  readonly beforeResolveHooks?: readonly ObjectLoaderHook[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ObjectLoaderExportSelection {
  readonly exportName?: string;
}

export type ObjectLoaderConstructor<T = object> = Constructor<T>;
