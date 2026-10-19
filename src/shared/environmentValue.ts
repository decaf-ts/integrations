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
/**
 * @description Returns a non-empty string when the value is a usable string
 * @summary Guards against `LoggedEnvironment` unset-leaf proxies: a value is
 * accepted only when it is actually a `string` with positive length, so proxy
 * placeholders and empty strings yield `undefined` instead of leaking into
 * config objects.
 * @param {unknown} value - The raw environment value to test.
 * @returns {string | undefined} The string value, or `undefined` when the value is not a non-empty string.
 */
export function envString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * @description Returns a finite number when the value is a usable number
 * @summary Accepts only real finite numbers, rejecting proxy placeholders,
 * `NaN`, and `Infinity` so numeric environment leaves produce `undefined`
 * rather than invalid config values.
 * @param {unknown} value - The raw environment value to test.
 * @returns {number | undefined} The numeric value, or `undefined` when the value is not a finite number.
 */
export function envNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * @description Returns a boolean when the value is actually a boolean
 * @summary Accepts only `true`/`false`; any other value (including proxy
 * placeholders and string-encoded flags) yields `undefined`.
 * @param {unknown} value - The raw environment value to test.
 * @returns {boolean | undefined} The boolean value, or `undefined` when the value is not a boolean.
 */
export function envBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
