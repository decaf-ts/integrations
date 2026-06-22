import { SecretProvider, type SecretReference } from "./SecretTypes";
import { SecretError } from "./SecretErrors";

const URI_PATTERN =
  /^secrets\/(?<provider>[a-z-]+)\/(?<name>[a-zA-Z0-9_-]+)(?:\/version\/(?<version>[a-zA-Z0-9_-]+))?$/ as unknown as RegExp;
const NAME_ONLY_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function parseSecretReference(ref: string): {
  provider: SecretProvider;
  name: string;
  version?: string;
} {
  const match = ref.match(URI_PATTERN);

  if (!match || !match.groups) {
    throw new SecretError(
      "SECRET_INVALID_NAME",
      `Invalid secret reference format: ${ref}`
    );
  }

  const { provider, name, version } = match.groups;

  if (!isValidProvider(provider as SecretProvider)) {
    throw new SecretError(
      "SECRET_INVALID_NAME",
      `Invalid provider in reference: ${provider}`
    );
  }

  return {
    provider: provider as SecretProvider,
    name,
    version,
  };
}

export function constructSecretReference(
  provider: SecretProvider,
  name: string,
  version?: string
): string {
  if (version) {
    return `secrets/${provider}/${name}/version/${version}`;
  }
  return `secrets/${provider}/${name}`;
}

export function isValidSecretReference(ref: string): boolean {
  try {
    parseSecretReference(ref);
    return true;
  } catch {
    return false;
  }
}

function isValidProvider(provider: string): provider is SecretProvider {
  const validProviders: SecretProvider[] = [
    "model",
    "memory",
    "hashicorp-vault",
    "aws-secrets-manager",
    "azure-key-vault",
    "gcp-secret-manager",
    "1password",
  ];
  return validProviders.includes(provider as SecretProvider);
}
