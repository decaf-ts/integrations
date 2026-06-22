/**
 * @module integrations/secrets/core/serialization
 * @summary Secret serialization helpers.
 * @description Utilities for converting secret payloads to and from transport-safe encodings.
 */
import { SecretError } from "./SecretErrors";
import type { SecretPayload, SerializedSecretPayload } from "./SecretTypes";

export function serializeSecretPayload(payload: SecretPayload): SerializedSecretPayload {
  if (typeof payload === "string") {
    return { encoding: "utf8", value: payload };
  }

  if (payload instanceof Uint8Array) {
    return {
      encoding: "base64",
      value: Buffer.from(payload).toString("base64"),
    };
  }

  if (typeof payload === "object" && payload !== null) {
    try {
      return {
        encoding: "json",
        value: JSON.stringify(payload),
      };
    } catch (error) {
      throw new SecretError(
        "SECRET_SERIALIZATION_FAILED",
        `Failed to serialize payload as JSON: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  throw new SecretError(
    "SECRET_INVALID_PAYLOAD",
    `Invalid payload type: ${typeof payload}`
  );
}

export function deserializeSecretPayload(
  serialized: import("./SecretTypes").SerializedSecretPayload
): SecretPayload {
  switch (serialized.encoding) {
    case "utf8":
      return serialized.value;
    case "json":
      try {
        return JSON.parse(serialized.value) as Record<string, unknown>;
      } catch (error) {
        throw new SecretError(
          "SECRET_DESERIALIZATION_FAILED",
          `Failed to deserialize JSON payload: ${(error as Error).message}`,
          error as Error
        );
      }
    case "base64":
      return Buffer.from(serialized.value, "base64");
    default:
      throw new SecretError(
        "SECRET_DESERIALIZATION_FAILED",
        `Unknown encoding: ${serialized.encoding}`
      );
  }
}
