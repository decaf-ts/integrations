import {
  AuthorizationError,
  ConnectionError,
  ForbiddenError,
  QueryError,
  UnsupportedError,
} from "@decaf-ts/core";
import {
  BadRequestError,
  BaseError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from "@decaf-ts/db-decorators";

/**
 * @description Base class for ERPNext adapter failures
 * @summary Extends the decaf `InternalError` family so every ERPNext failure is a
 * `BaseError` with the standard `[Name][code] message` shape. Never throw a raw
 * `Error` from this module.
 * @class ERPNextError
 * @memberOf module:erpnext
 */
export class ERPNextError extends InternalError {
  constructor(msg: string | Error, name = ERPNextError.name, code = 500) {
    super(msg, name, code);
    this.name = name;
  }
}

/**
 * @description Authentication failure (invalid token, failed session login)
 * @class ERPNextAuthenticationError
 * @extends AuthorizationError
 * @memberOf module:erpnext
 */
export class ERPNextAuthenticationError extends AuthorizationError {
  constructor(msg: string | Error) {
    super(msg, ERPNextAuthenticationError.name, 401);
    this.name = ERPNextAuthenticationError.name;
  }
}

/**
 * @description Authorised caller without the required Frappe permission
 * @class ERPNextPermissionError
 * @extends ForbiddenError
 * @memberOf module:erpnext
 */
export class ERPNextPermissionError extends ForbiddenError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPermissionError.name;
  }
}

/**
 * @description The requested document does not exist
 * @class ERPNextNotFoundError
 * @extends NotFoundError
 * @memberOf module:erpnext
 */
export class ERPNextNotFoundError extends NotFoundError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextNotFoundError.name;
  }
}

/**
 * @description The document changed concurrently or already exists
 * @class ERPNextConflictError
 * @extends ConflictError
 * @memberOf module:erpnext
 */
export class ERPNextConflictError extends ConflictError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextConflictError.name;
  }
}

/**
 * @description Frappe rejected the document payload
 * @class ERPNextValidationError
 * @extends ValidationError
 * @memberOf module:erpnext
 */
export class ERPNextValidationError extends ValidationError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextValidationError.name;
  }
}

/**
 * @description The site could not be reached or the connection dropped
 * @class ERPNextConnectionError
 * @extends ConnectionError
 * @memberOf module:erpnext
 */
export class ERPNextConnectionError extends ConnectionError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextConnectionError.name;
  }
}

/**
 * @description A query could not be translated or executed
 * @class ERPNextQueryError
 * @extends QueryError
 * @memberOf module:erpnext
 */
export class ERPNextQueryError extends QueryError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextQueryError.name;
  }
}

/**
 * @description The operation is not supported by the ERPNext REST API
 * @class ERPNextUnsupportedError
 * @extends UnsupportedError
 * @memberOf module:erpnext
 */
export class ERPNextUnsupportedError extends UnsupportedError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextUnsupportedError.name;
  }
}

/**
 * @description Extracts a readable message from a Frappe error body
 * @summary Frappe reports validation failures in `_server_messages` (a JSON
 * encoded array of JSON objects), and generic failures in `exception` or
 * `message`. This helper normalizes all of them to a single string.
 * @param {unknown} body - The raw response body
 * @return {string | undefined} The extracted message, when available
 * @function erpNextErrorMessage
 * @memberOf module:erpnext
 */
export function erpNextErrorMessage(body: unknown): string | undefined {
  if (body === null || typeof body === "undefined") return undefined;
  if (typeof body === "string") {
    try {
      return erpNextErrorMessage(JSON.parse(body)) ?? body;
    } catch {
      return body;
    }
  }
  if (Array.isArray(body)) {
    for (const item of body) {
      const message = erpNextErrorMessage(item);
      if (message) return message;
    }
    return undefined;
  }
  if (typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of [
      "_server_messages",
      "exception",
      "message",
      "error",
      "exc_type",
    ]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        if (key === "_server_messages") {
          try {
            return erpNextErrorMessage(JSON.parse(value)) ?? value;
          } catch {
            return value;
          }
        }
        if (key === "exception") {
          return value.replace(/^[\w.]+Error:\s*/, "");
        }
        return value;
      }
      if (value && typeof value === "object") {
        const nested = erpNextErrorMessage(value);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
 * @description Rebuilds the decaf error of a failed ERPNext call
 * @summary Resolution order: an already-decaf error is returned unchanged; a
 * numeric status maps to the matching decaf class; an ERPNext/Frappe error type
 * (`exc_type` or `_server_messages`) refines the mapping (validation, permission,
 * conflict, not found); anything else becomes an {@link ERPNextError}.
 * @param {number | undefined} status - The HTTP status
 * @param {unknown} [body] - The response body
 * @return {BaseError} The decaf error
 * @function parseERPNextError
 * @memberOf module:erpnext
 */
export function parseERPNextError(
  status?: number,
  body?: unknown
): BaseError {
  if (body instanceof BaseError) return body;
  const message =
    erpNextErrorMessage(body) ??
    (status ? `ERPNext request failed with HTTP ${status}` : "ERPNext request failed");
  const excType =
    body && typeof body === "object"
      ? String((body as Record<string, unknown>).exc_type ?? "")
      : "";
  const normalizedType = excType.toLowerCase();

  if (
    normalizedType.includes("permission") ||
    normalizedType.includes("forbidden") ||
    status === 403
  )
    return new ERPNextPermissionError(message);
  if (
    normalizedType.includes("authentication") ||
    normalizedType.includes("unauthorized") ||
    status === 401
  )
    return new ERPNextAuthenticationError(message);
  if (
    normalizedType.includes("notfound") ||
    normalizedType.includes("doesnotexist") ||
    status === 404
  )
    return new ERPNextNotFoundError(message);
  if (
    normalizedType.includes("validation") ||
    normalizedType.includes("mandatory") ||
    normalizedType.includes("invalid") ||
    status === 417 ||
    status === 422
  )
    return new ERPNextValidationError(message);
  if (
    normalizedType.includes("duplicate") ||
    normalizedType.includes("conflict") ||
    status === 409
  )
    return new ERPNextConflictError(message);

  switch (status) {
    case 400:
      return new BadRequestError(message, ERPNextError.name, 400);
    case 405:
      return new ERPNextUnsupportedError(message);
    case 408:
    case 429:
    case 502:
    case 503:
    case 504:
      return new ERPNextConnectionError(message);
    default:
      return new ERPNextError(message, ERPNextError.name, status ?? 500);
  }
}
