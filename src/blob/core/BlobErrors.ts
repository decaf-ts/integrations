/**
 * @module integrations/blob/core/errors
 * @summary Blob error translation helpers.
 * @description Re-exports standard DECAF errors used by blob store implementations and provides
 * helper functions for translating provider library errors into the appropriate DECAF error types.
 */
import {
  AuthorizationError,
  ConnectionError,
  ForbiddenError,
  UnsupportedError,
} from "@decaf-ts/core";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from "@decaf-ts/db-decorators";

export {
  AuthorizationError,
  BadRequestError,
  ConflictError,
  ConnectionError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnsupportedError,
  ValidationError,
};

/**
 * Translates a generic error into a DECAF error based on HTTP status code or message keywords.
 * Used as a fallback by provider parseError methods.
 */
export function translateBlobError(error: Error): Error {
  if (
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof AuthorizationError ||
    error instanceof ForbiddenError ||
    error instanceof ValidationError ||
    error instanceof ConnectionError ||
    error instanceof UnsupportedError ||
    error instanceof InternalError
  ) {
    return error;
  }

  const message = error.message || error.name || "Unknown error";
  const lowerMessage = message.toLowerCase();
  const statusCode =
    (error as any)?.statusCode ||
    (error as any)?.$metadata?.httpStatusCode ||
    (error as any)?.code;

  if (
    lowerMessage.includes("not found") ||
    statusCode === 404 ||
    lowerMessage.includes("enoent") ||
    lowerMessage.includes("blobnotfound") ||
    statusCode === "ENOENT"
  ) {
    return new NotFoundError(error);
  }

  if (
    lowerMessage.includes("already exists") ||
    lowerMessage.includes("conflict") ||
    statusCode === 409 ||
    statusCode === "EEXIST"
  ) {
    return new ConflictError(error);
  }

  if (lowerMessage.includes("unauthorized") || statusCode === 401) {
    return new AuthorizationError(error);
  }

  if (lowerMessage.includes("permission") || statusCode === 403) {
    return new ForbiddenError(error);
  }

  if (
    lowerMessage.includes("rate limit") ||
    statusCode === 429
  ) {
    return new ConflictError(error);
  }

  if (
    lowerMessage.includes("connection") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("unavailable") ||
    statusCode === 503
  ) {
    return new ConnectionError(error);
  }

  return new InternalError(error);
}
