/**
 * @module integrations/secrets/core/types
 * @summary Secret core types.
 * @description Shared payload, metadata, option, and configuration types for secret service implementations.
 */
export type SecretProvider =
  | "model"
  | "memory"
  | "hashicorp-vault"
  | "aws-secrets-manager"
  | "azure-key-vault"
  | "gcp-secret-manager"
  | "1password";

export type SecretName = string;

export type SecretPayload = string | Record<string, unknown> | Uint8Array;

export interface SerializedSecretPayload {
  encoding: "utf8" | "json" | "base64";
  value: string;
}

export interface SecretReference {
  provider: SecretProvider;
  name: string;
  version?: string;
  path?: string;
  uri?: string;
  tenantId?: string;
  namespace?: string;
  metadata?: Record<string, string>;
}

export interface SecretMetadata {
  provider: SecretProvider;
  name: string;
  version?: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
  enabled?: boolean;
  contentType?: string;
  tags?: Record<string, string>;
  externalId?: string;
  uri?: string;
}

export interface SecretServiceConfig {
  provider: SecretProvider;
  keyId?: string;
  keyRotation?: {
    enabled: boolean;
    period?: string;
  };
  [key: string]: unknown;
}

export interface StoreSecretOptions {
  contentType?: string;
  tags?: Record<string, string>;
  version?: string;
  ttl?: number;
}

export interface RetrieveSecretOptions {
  version?: string;
  includeMetadata?: boolean;
}

export interface DeleteSecretOptions {
  force?: boolean;
  version?: string;
}

export interface ExistsSecretOptions {
  version?: string;
}

export interface ListSecretsOptions {
  limit?: number;
  offset?: number;
  tags?: Record<string, string>;
  enabled?: boolean;
}

export interface SecretMetadataOptions {
  version?: string;
  includeTags?: boolean;
}

export interface RotateSecretOptions {
  oldVersion?: string;
  newVersion?: string;
  keyId?: string;
}
