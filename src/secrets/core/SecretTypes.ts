/**
 * @module integrations/secrets/core/types
 * @summary Secret core types.
 * @description Shared payload, metadata, option, and configuration types for secret service implementations.
 */
export type SecretProvider =
  | "model"
  | "memory"
  | "filesystem"
  | "hashicorp-vault"
  | "aws-secrets-manager"
  | "azure-key-vault"
  | "gcp-secret-manager"
  | "1password"
  | "kubernetes";

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
  /**
   * @description Namespace tenant that owns the secret.
   * @summary Stamped onto model-backed secrets so the namespace RLS policies
   * can scope reads and writes without joining the credential row.
   */
  tenantId?: string;
  /**
   * @description Organizational unit that owns the secret.
   */
  orgUnitId?: string;
  /**
   * @description Principal that owns the secret.
   */
  ownerPrincipalId?: string;
  /**
   * @description Backend namespace or tenant partition for the secret.
   * @summary Kubernetes uses this as the object namespace; other providers may
   * ignore it when their backend is not namespace-scoped.
   */
  namespace?: string;
}

export interface RetrieveSecretOptions {
  version?: string;
  includeMetadata?: boolean;
  namespace?: string;
}

export interface DeleteSecretOptions {
  force?: boolean;
  version?: string;
  namespace?: string;
}

export interface ExistsSecretOptions {
  version?: string;
  namespace?: string;
}

export interface ListSecretsOptions {
  limit?: number;
  offset?: number;
  tags?: Record<string, string>;
  enabled?: boolean;
  namespace?: string;
}

export interface SecretMetadataOptions {
  version?: string;
  includeTags?: boolean;
  namespace?: string;
}

export interface RotateSecretOptions {
  oldVersion?: string;
  newVersion?: string;
  keyId?: string;
  namespace?: string;
}
