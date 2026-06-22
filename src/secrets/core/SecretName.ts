import { SecretError } from "./SecretErrors";

const MAX_NAME_LENGTH = 255;
const SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

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

  if (hasControlCharacters(trimmed)) {
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
