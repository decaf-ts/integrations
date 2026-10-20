/**
 * @module integrations/secrets/model/model
 * @summary Encrypted-at-rest secret persistence model.
 * @description Defines the `{@link Secret}` model (`secrets` table) persisted
 * by the `{@link ModelSecretService}`: one row per secret, holding the
 * encrypted payload, `keyId`/`iv`/`salt` encryption metadata, versioning and
 * enablement fields, and optional tenant/org-unit/owner scoping columns.
 */
import { BaseModel, column, pk, table, uuid } from "@decaf-ts/core";
import { description } from "@decaf-ts/decoration";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";

/**
 * @description Encryption metadata embedded in a secret row
 * @summary `keyId` identifies the key used to encrypt the payload; `iv` and
 * the optional `aad`/`salt` carry the cipher parameters needed to re-derive
 * the key and decrypt the payload.
 */
export interface SecretEncryptionMetadata {
  /** @description Identifier of the encryption key used for the payload. */
  keyId: string;
  /** @description Initialization vector used for the payload encryption. */
  iv: string;
  /** @description Optional additional authenticated data bound to the cipher. */
  aad?: string;
  /** @description Optional salt used when deriving the key from the master secret. */
  salt?: string;
}

/**
 * @description Encrypted secret record stored through the model-backed secret service
 * @summary Persisted in the `secrets` table. The `encryptedPayload` column is
 * written only by `{@link ModelSecretService}` (which also fills
 * `encryption`, `version`, and the optional `tenantId`/`orgUnitId`/
 * `ownerPrincipalId` scoping columns); `enabled: false` marks soft-deleted
 * secrets that retrieval filters out.
 * @category Secrets
 */
@table("secrets")
@model()
@description(
  "Encrypted secret record stored through the model-backed secret service"
)
export class Secret extends BaseModel {
  /** @description Primary key (UUID). */
  @pk({ type: String })
  @uuid()
  id!: string;

  /** @description Normalized secret name. */
  @required()
  @typeOf(String)
  @column()
  name!: string;

  /** @description Secret provider discriminator that wrote the row. */
  @required()
  @typeOf(String)
  @column()
  provider!: string;

  /** @description Encrypted, serialized payload. */
  @required()
  @typeOf(String)
  @column()
  encryptedPayload!: string;

  /** @description Cipher parameters required to decrypt the payload. */
  @required()
  @typeOf(Object)
  @column()
  encryption!: SecretEncryptionMetadata;

  /** @description Optional content type describing the payload. */
  @typeOf(String)
  @column()
  contentType?: string;

  /** @description Optional free-form tags. */
  @typeOf(Object)
  @column()
  tags?: Record<string, string>;

  /** @description When `false`, the secret is soft-deleted and filtered from retrieval. */
  @typeOf(Boolean)
  @column()
  enabled: boolean = true;

  /** @description Optional version label. */
  @typeOf(String)
  @column()
  version?: string;

  /** @description Optional external identifier linking the secret to a provider record. */
  @typeOf(String)
  @column()
  externalId?: string;

  /** @description Optional provider URI for externally stored secrets. */
  @typeOf(String)
  @column()
  uri?: string;

  /** @description Optional tenant scope id. */
  @typeOf(String)
  @column("tenant_id")
  tenantId?: string;

  /** @description Optional organizational unit scope id. */
  @typeOf(String)
  @column("org_unit_id")
  orgUnitId?: string;

  /** @description Optional owning principal id. */
  @typeOf(String)
  @column("owner_principal_id")
  ownerPrincipalId?: string;

  constructor(data?: Partial<Secret>) {
    super(data);
  }
}
