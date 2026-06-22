/**
 * @module integrations/secrets/core/errors
 * @summary Secret core errors.
 * @description Error classes used by the secret service abstraction and provider implementations.
 */
import { InternalError } from "@decaf-ts/db-decorators";

export type SecretErrorCode =
  | "SECRET_NOT_FOUND"
  | "SECRET_ALREADY_EXISTS"
  | "SECRET_DISABLED"
  | "SECRET_INVALID_NAME"
  | "SECRET_INVALID_PAYLOAD"
  | "SECRET_SERIALIZATION_FAILED"
  | "SECRET_DESERIALIZATION_FAILED"
  | "SECRET_ENCRYPTION_FAILED"
  | "SECRET_DECRYPTION_FAILED"
  | "SECRET_PROVIDER_UNAVAILABLE"
  | "SECRET_PROVIDER_AUTH_FAILED"
  | "SECRET_PROVIDER_PERMISSION_DENIED"
  | "SECRET_PROVIDER_RATE_LIMITED"
  | "SECRET_PROVIDER_CONFLICT"
  | "SECRET_UNSUPPORTED_OPERATION";

export class SecretError extends InternalError {
  readonly secretCode: SecretErrorCode;

  constructor(secretCode: SecretErrorCode, message: string, cause?: Error) {
    super(message);
    this.secretCode = secretCode;
    this.name = "SecretError";
    if (cause) {
      (this as any).cause = cause;
    }
  }
}

export function translateError(error: Error): SecretError {
  const message = error.message || error.name;
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
    return new SecretError(
      "SECRET_NOT_FOUND",
      `Secret not found: ${message}`,
      error
    );
  }

  if (
    lowerMessage.includes("already exists") ||
    lowerMessage.includes("conflict") ||
    lowerMessage.includes("409")
  ) {
    return new SecretError(
      "SECRET_ALREADY_EXISTS",
      `Secret already exists: ${message}`,
      error
    );
  }

  if (lowerMessage.includes("disabled") || lowerMessage.includes("403")) {
    return new SecretError(
      "SECRET_DISABLED",
      `Secret is disabled: ${message}`,
      error
    );
  }

  if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
    return new SecretError(
      "SECRET_PROVIDER_AUTH_FAILED",
      `Authentication failed: ${message}`,
      error
    );
  }

  if (lowerMessage.includes("permission") || lowerMessage.includes("403")) {
    return new SecretError(
      "SECRET_PROVIDER_PERMISSION_DENIED",
      `Permission denied: ${message}`,
      error
    );
  }

  if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
    return new SecretError(
      "SECRET_PROVIDER_RATE_LIMITED",
      `Rate limited: ${message}`,
      error
    );
  }

  if (
    lowerMessage.includes("provider") ||
    lowerMessage.includes("unavailable") ||
    lowerMessage.includes("connection") ||
    lowerMessage.includes("timeout")
  ) {
    return new SecretError(
      "SECRET_PROVIDER_UNAVAILABLE",
      `Provider unavailable: ${message}`,
      error
    );
  }

  return new SecretError(
    "SECRET_PROVIDER_CONFLICT",
    `Provider error: ${message}`,
    error
  );
}

export function translateNameError(error: Error): SecretError {
  return new SecretError(
    "SECRET_INVALID_NAME",
    `Invalid secret name: ${error.message}`,
    error
  );
}

export function translateSerializationError(
  error: Error,
  operation: "serialize" | "deserialize"
): SecretError {
  return new SecretError(
    operation === "serialize"
      ? "SECRET_SERIALIZATION_FAILED"
      : "SECRET_DESERIALIZATION_FAILED",
    `Payload ${operation} failed: ${error.message}`,
    error
  );
}

export function translateCryptoError(
  error: Error,
  operation: "encryption" | "decryption"
): SecretError {
  return new SecretError(
    operation === "encryption"
      ? "SECRET_ENCRYPTION_FAILED"
      : "SECRET_DECRYPTION_FAILED",
    `Crypto ${operation} failed: ${error.message}`,
    error
  );
}
