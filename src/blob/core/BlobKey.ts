/**
 * @module integrations/blob/core/key
 * @summary Blob key helpers.
 * @description Validation, cleaning, and prefixing helpers for blob keys.
 */
import { ValidationError } from "@decaf-ts/db-decorators";
import type { BlobKey } from "./BlobTypes";

/**
 * Strips leading slashes from a blob key and rejects unsafe path segments.
 */
export function cleanKey(key: BlobKey): string {
  if (typeof key !== "string") {
    throw new ValidationError(`Blob key must be a string`);
  }

  const clean = key.replace(/^\/+/, "");

  if (
    clean === "" ||
    clean === "." ||
    clean === ".." ||
    clean.includes("../") ||
    clean.startsWith("../")
  ) {
    throw new ValidationError(`Invalid blob key: ${key}`);
  }

  return clean;
}

/**
 * Applies the configured prefix (trimmed of leading/trailing slashes) to a cleaned key.
 */
export function physicalKey(key: BlobKey, prefix?: string): string {
  const clean = cleanKey(key);
  const trimmedPrefix = prefix?.replace(/^\/+|\/+$/g, "");
  return trimmedPrefix ? `${trimmedPrefix}/${clean}` : clean;
}
