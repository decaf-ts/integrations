/**
 * @module integrations/namespaces/rls/session-binding
 * @summary Maps an authenticated request context to the Postgres session settings consumed by the namespace RLS policies.
 * @description Exposes {@link namespaceRlsSessionBinding} and the
 * `namespaceRlsTypeORMOptions()` convenience wrapper: a fail-closed,
 * config-only seam that turns the principal UUID carried on a decaf `Context`
 * into a `{ [RLS_SETTINGS.Principal]: principalId }` settings map the TypeORM
 * adapter binds transaction-locally after `BEGIN`. Nothing is bound when the
 * context carries no UUID-shaped principal, so Postgres RLS denies
 * protected-row access instead of silently serving an anonymous read.
 */
import type { Context } from "@decaf-ts/core";
import { PRINCIPAL_UUID_PATTERN } from "./principal-resolver";
import { RLS_SETTINGS } from "./rls.constants";

/**
 * @description Session settings map handed to the persistence adapter's session binding
 * @summary A plain `name -> value` map of Postgres session variables. The
 * binding produced here uses exactly one key: {@link RLS_SETTINGS.Principal}
 * (`app.principal_id`) from `./rls.constants` - the single source of truth
 * also interpolated by `./rls.template` into the RLS helper functions and
 * policies - so renaming the setting in one place renames it everywhere.
 * @typedef {Record<string, string>} NamespaceRlsSessionSettings
 */
export type NamespaceRlsSessionSettings = Record<string, string>;

/**
 * @description Resolver that maps a request context to RLS session settings
 * @summary Invoked by the persistence adapter at transaction start with the
 * request `Context` (if any). Returns the settings to bind
 * transaction-locally, or `undefined` when nothing should be bound. Must be
 * synchronous and side-effect free: the consuming adapter treats a throw from
 * the binding as "no settings" and leaves the transaction unbound (fail
 * closed).
 * @typedef {(context?: Context<any>) => NamespaceRlsSessionSettings | undefined} NamespaceRlsSessionBinding
 */
export type NamespaceRlsSessionBinding = (
  context?: Context<any>
) => NamespaceRlsSessionSettings | undefined;

/**
 * @description Options for the namespace RLS session binding
 * @summary Lets hosts relocate the context keys the default binding reads and
 * override the warning sink. The defaults read `principalId` (the resolved
 * principal UUID carried on the request context) and `user` (the
 * authenticated identity marker), and warn through `console.warn`.
 * @interface NamespaceRlsSessionBindingOptions
 * @property {string} [principalContextKey] - Context key holding the resolved principal UUID. Defaults to `principalId`.
 * @property {string} [authenticatedContextKey] - Context key that marks the context as authenticated; consulted only to decide whether to warn. Defaults to `user`.
 * @property {(message: string) => void} [warn] - Warning sink invoked when an authenticated context has no resolvable principal. Defaults to `console.warn`; the message never contains any setting or principal value.
 */
export interface NamespaceRlsSessionBindingOptions {
  principalContextKey?: string;
  authenticatedContextKey?: string;
  warn?: (message: string) => void;
}

function readContextKey(context: Context<any>, key: string): unknown {
  try {
    return context.getOrUndefined(key as any);
  } catch {
    return undefined;
  }
}

/**
 * @description Builds the namespace RLS session binding for a request context
 * @summary Returns a resolver that reads the configured principal context key
 * (default `principalId`), trims the candidate, and - when it is a
 * UUID-shaped string - produces
 * `{ [RLS_SETTINGS.Principal]: principalId }` for the adapter to bind
 * transaction-locally. Fail closed: a missing context, an absent, empty, or
 * non-UUID candidate, or a context lookup error yields `undefined`, so
 * nothing is bound and Postgres RLS denies protected-row access. When the
 * context looks authenticated (the configured authenticated context key
 * resolves) but carries no valid principal, the resolver emits a single
 * warning through the configured `warn` sink (default `console.warn`),
 * without logging any setting or principal value.
 * @function namespaceRlsSessionBinding
 * @param {NamespaceRlsSessionBindingOptions} [options] - Overrides for the context keys and the warning sink.
 * @returns {NamespaceRlsSessionBinding} The context-to-settings resolver.
 * @example
 * const binding = namespaceRlsSessionBinding();
 * const settings = binding(ctx); // { "app.principal_id": "<uuid>" } or undefined
 */
export function namespaceRlsSessionBinding(
  options: NamespaceRlsSessionBindingOptions = {}
): NamespaceRlsSessionBinding {
  const principalContextKey = options.principalContextKey ?? "principalId";
  const authenticatedContextKey = options.authenticatedContextKey ?? "user";
  const warn = options.warn ?? ((message: string) => console.warn(message));

  return (context) => {
    if (!context) return undefined;

    const candidate = readContextKey(context, principalContextKey);
    const principalId =
      typeof candidate === "string" ? candidate.trim() : "";

    if (!principalId || !PRINCIPAL_UUID_PATTERN.test(principalId)) {
      if (readContextKey(context, authenticatedContextKey))
        warn(
          `Authenticated context has no resolvable namespace principal; ${RLS_SETTINGS.Principal} will not be bound and RLS will deny`
        );
      return undefined;
    }

    return { [RLS_SETTINGS.Principal]: principalId };
  };
}

/**
 * @description Builds the `sessionBinding` option for the TypeORM adapter
 * @summary Convenience wrapper that spreads the namespaced RLS binding into a
 * TypeORM adapter configuration: merge the returned object into
 * `TypeORMAdapterOptions` and `TypeORMContextLock` binds the resolved
 * {@link RLS_SETTINGS.Principal} transaction-locally after `BEGIN`. This is
 * configuration only - no subclassing or method overrides.
 * @function namespaceRlsTypeORMOptions
 * @param {NamespaceRlsSessionBindingOptions} [options] - Overrides forwarded to {@link namespaceRlsSessionBinding}.
 * @returns {{ sessionBinding: NamespaceRlsSessionBinding }} An object to spread into the TypeORM adapter options.
 * @example
 * import { namespaceRlsTypeORMOptions } from "@decaf-ts/integrations/namespaces";
 * const adapter = new TypeORMAdapter({ ...dataSourceOptions, ...namespaceRlsTypeORMOptions() });
 */
export function namespaceRlsTypeORMOptions(
  options: NamespaceRlsSessionBindingOptions = {}
): { sessionBinding: NamespaceRlsSessionBinding } {
  return { sessionBinding: namespaceRlsSessionBinding(options) };
}
