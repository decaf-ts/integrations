/**
 * @module integrations/shared/environment-value
 * @summary Helpers for reading primitive values out of decaf-ts Environment instances.
 * @description `@decaf-ts/logging`'s `Environment` resolves an unset leaf property to a
 * Proxy object rather than `undefined` when it is reached through a path that was not
 * part of the model captured by the last `.accumulate()` call for that root key (the
 * proxy exists so callers can still compose the fully-qualified env-var key name via
 * `String(...)`). Such proxies are objects, so they are truthy and pass straight through
 * a bare `if (!value)` check, and they do not have the shape callers expect (e.g. no
 * `.replace` on what looks like a string). Every `configFromEnvironment()` implementation
 * must use these helpers instead of a raw truthiness check, both to decide whether a
 * field was really configured and to build the config object it returns.
 */
export function envString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function envNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function envBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
