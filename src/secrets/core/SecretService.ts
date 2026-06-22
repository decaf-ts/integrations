import { SecretProvider, SecretServiceConfig } from "./SecretTypes";
import { Service } from "@decaf-ts/core";
import { SecretName, SecretPayload, SecretReference } from "./SecretTypes";
import { SecretMetadata, StoreSecretOptions } from "./SecretTypes";
import {
  RetrieveSecretOptions,
  DeleteSecretOptions,
  ExistsSecretOptions,
  ListSecretsOptions,
  SecretMetadataOptions,
  RotateSecretOptions,
} from "./SecretTypes";

export abstract class SecretService<
  TClient = unknown,
  TConfig extends SecretServiceConfig = SecretServiceConfig,
> extends Service {
  readonly provider: SecretProvider;
  readonly config: Readonly<TConfig>;

  protected constructor(config: TConfig) {
    super();
    this.config = Object.freeze({ ...config });
    this.provider = config.provider;
  }

  abstract store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options?: StoreSecretOptions
  ): Promise<SecretReference>;

  abstract retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options?: RetrieveSecretOptions
  ): Promise<T>;

  abstract delete(
    nameOrRef: SecretName | SecretReference,
    options?: DeleteSecretOptions
  ): Promise<void>;

  abstract exists(
    nameOrRef: SecretName | SecretReference,
    options?: ExistsSecretOptions
  ): Promise<boolean>;

  abstract list(
    options?: ListSecretsOptions
  ): Promise<SecretMetadata[]>;

  abstract metadata(
    nameOrRef: SecretName | SecretReference,
    options?: SecretMetadataOptions
  ): Promise<SecretMetadata | undefined>;

  rotate?(
    nameOrRef: SecretName | SecretReference,
    value: SecretPayload,
    options?: RotateSecretOptions
  ): Promise<SecretReference>;
}
