import { SecretName } from "./SecretTypes";
import { SecretError } from "./SecretErrors";

const MAX_NAME_LENGTH = 255;
const SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

export function validateSecretName(name: string): boolean {
  if (!name || typeof name !== "string") {
    return false;
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    return false;
  }

  if (CONTROL_CHARS_REGEX.test(trimmed)) {
    return false;
  }

  if (trimmed.includes("..")) {
    return false;
  }

  if (trimmed.includes("   ")) {
    return false;
  }

  if (!SAFE_PATTERN.test(trimmed)) {
    return false;
  }

  return true;
}

export function normalizeSecretName(name: string): string {
  if (!validateSecretName(name)) {
    throw new SecretError(
      "SECRET_INVALID_NAME",
      `Invalid secret name: ${name}`
    );
  }

  return name.trim();
}
