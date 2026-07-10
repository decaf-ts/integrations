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
  | "node";

export type ObjectLoaderSource = string | URL;

export type MaybePromise<T> = T | Promise<T>;

export interface ObjectLoaderHookContext {
  readonly family: ObjectLoaderFamily;
  readonly source: string;
  readonly exportName: string;
  readonly module: Readonly<Record<string, unknown>>;
  readonly loaderName: string;
}

export type ObjectLoaderHook = (
  value: unknown,
  context: ObjectLoaderHookContext
) => MaybePromise<unknown | void>;

export interface ObjectLoaderOptions {
  readonly family?: ObjectLoaderFamily;
  readonly hooks?: readonly ObjectLoaderHook[];
  readonly defaultExportName?: string;
}

export interface ObjectLoaderLoadOptions {
  readonly hooks?: readonly ObjectLoaderHook[];
}

export interface ObjectLoaderExportSelection {
  readonly exportName?: string;
}

export type ObjectLoaderConstructor<T = object> = Constructor<T>;
