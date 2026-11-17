import {
  AuthorizationError,
  ConnectionError,
  ForbiddenError,
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
import type { ERPNextPaymentProviderKey } from "./types";

/**
 * @description Base error for ERPNext payment failures
 * @summary Wraps unexpected provider or integration failures with a configurable name and code; defaults to HTTP 500.
 * @class ERPNextPaymentError
 * @category ERPNext
 */
export class ERPNextPaymentError extends InternalError {
  constructor(msg: string | Error, name = ERPNextPaymentError.name, code = 500) {
    super(msg, name, code);
    this.name = name;
  }
}

/**
 * @description Payment configuration validation error
 * @summary Raised when required provider configuration is missing or invalid.
 * @class ERPNextPaymentConfigurationError
 * @category ERPNext
 */
export class ERPNextPaymentConfigurationError extends ValidationError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentConfigurationError.name;
  }
}

/**
 * @description Payment provider authentication error
 * @summary Raised when a provider rejects credentials or the request lacks a valid token (HTTP 401).
 * @class ERPNextPaymentAuthenticationError
 * @category ERPNext
 */
export class ERPNextPaymentAuthenticationError extends AuthorizationError {
  constructor(msg: string | Error) {
    super(msg, ERPNextPaymentAuthenticationError.name, 401);
    this.name = ERPNextPaymentAuthenticationError.name;
  }
}

/**
 * @description Payment provider authorization error
 * @summary Raised when the provider denies access to the requested resource (HTTP 403).
 * @class ERPNextPaymentForbiddenError
 * @category ERPNext
 */
export class ERPNextPaymentForbiddenError extends ForbiddenError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentForbiddenError.name;
  }
}

/**
 * @description Payment resource not found error
 * @summary Raised when the provider reports that the requested resource does not exist (HTTP 404).
 * @class ERPNextPaymentNotFoundError
 * @category ERPNext
 */
export class ERPNextPaymentNotFoundError extends NotFoundError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentNotFoundError.name;
  }
}

/**
 * @description Payment resource conflict error
 * @summary Raised when the provider refuses the request because of a conflicting state (HTTP 409).
 * @class ERPNextPaymentConflictError
 * @category ERPNext
 */
export class ERPNextPaymentConflictError extends ConflictError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentConflictError.name;
  }
}

/**
 * @description Payment provider request error
 * @summary Raised for provider-side validation failures (HTTP 400 or 422).
 * @class ERPNextPaymentProviderError
 * @category ERPNext
 */
export class ERPNextPaymentProviderError extends BadRequestError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentProviderError.name;
  }
}

/**
 * @description Payment webhook validation error
 * @summary Raised when an incoming webhook cannot be verified or parsed.
 * @class ERPNextPaymentWebhookError
 * @category ERPNext
 */
export class ERPNextPaymentWebhookError extends ValidationError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentWebhookError.name;
  }
}

/**
 * @description Unsupported payment operation error
 * @summary Raised when a provider does not support a requested payment operation.
 * @class ERPNextPaymentUnsupportedError
 * @category ERPNext
 */
export class ERPNextPaymentUnsupportedError extends UnsupportedError {
  constructor(msg: string | Error) {
    super(msg);
    this.name = ERPNextPaymentUnsupportedError.name;
  }
}

/**
 * @description Extracts a human readable message from a provider error body
 * @summary Recursively inspects strings, arrays and common error fields so the
 * most relevant provider message is surfaced.
 * @param {unknown} body - The raw provider response body
 * @return {string|undefined} The extracted message, or `undefined`
 */
export function paymentProviderErrorMessage(
  body: unknown
): string | undefined {
  if (body === null || typeof body === "undefined") return undefined;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return undefined;
    try {
      return paymentProviderErrorMessage(JSON.parse(trimmed)) ?? trimmed;
    } catch {
      return trimmed;
    }
  }
  if (Array.isArray(body)) {
    for (const entry of body) {
      const message = paymentProviderErrorMessage(entry);
      if (message) return message;
    }
    return undefined;
  }
  if (typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of [
      "message",
      "error_description",
      "detail",
      "description",
      "error",
      "errors",
      "exception",
      "Ds_ErrorCode",
      "Ds_Response",
    ]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        const nested = paymentProviderErrorMessage(value);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
 * @description Maps a provider response to the matching decaf error
 * @summary Classifies the HTTP status into authentication, authorization,
 * not-found, conflict, validation or connection errors, prefixing the provider
 * key to the extracted message.
 * @param {ERPNextPaymentProviderKey} provider - The payment provider key
 * @param {number} status - The HTTP status, when available
 * @param {unknown} [body] - The raw provider response body
 * @return {BaseError} The classified decaf error
 */
export function parsePaymentProviderError(
  provider: ERPNextPaymentProviderKey,
  status: number | undefined,
  body?: unknown
): BaseError {
  if (body instanceof BaseError) return body;
  const extracted = paymentProviderErrorMessage(body);
  const message =
    extracted ??
    `${provider} payment provider request failed${
      status ? ` with HTTP ${status}` : ""
    }`;
  const prefix = `${provider}: ${message}`;

  if (status === 401) return new ERPNextPaymentAuthenticationError(prefix);
  if (status === 403) return new ERPNextPaymentForbiddenError(prefix);
  if (status === 404) return new ERPNextPaymentNotFoundError(prefix);
  if (status === 409) return new ERPNextPaymentConflictError(prefix);
  if (status === 400 || status === 422)
    return new ERPNextPaymentProviderError(prefix);
  if (status === 408 || status === 429 || (status && status >= 500))
    return new ConnectionError(prefix);
  return new ERPNextPaymentError(prefix, ERPNextPaymentError.name, status ?? 500);
}
