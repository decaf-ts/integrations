/**
 * @module integrations/secrets/model/secret
 * @summary Encrypted secret model types.
 * @description Model payload and metadata types used by the encrypted-at-rest secret service.
 */
import { BaseModel } from "@decaf-ts/core";
import { required } from "@decaf-ts/decorator-validation";

export interface SecretEncryptionMetadata {
  keyId: string;
  iv: string;
  aad?: string;
}

export class Secret extends BaseModel {
  @required()
  name!: string;

  @required()
  provider!: string;

  @required()
  encryptedPayload!: string;

  @required()
  encryption!: SecretEncryptionMetadata;

  contentType?: string;
  tags?: Record<string, string>;
  enabled: boolean = true;
  version?: string;
  externalId?: string;
  uri?: string;

  constructor(data?: Partial<Secret>) {
    super(data);
  }
}
