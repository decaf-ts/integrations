import { SecretError, SecretProvider } from "../core";
import { SecretName, SecretPayload, SecretReference, SecretMetadata } from "../core";
import {
  StoreSecretOptions,
  RetrieveSecretOptions,
  DeleteSecretOptions,
  ExistsSecretOptions,
  ListSecretsOptions,
  SecretMetadataOptions,
} from "../core";
import { validateSecretName, normalizeSecretName } from "../core";
import { serializeSecretPayload, deserializeSecretPayload, type SerializedSecretPayload } from "../core";
import { Secret } from "./Secret";
import { ClientBasedService, ContextualArgs, MaybeContextualArg, Repository } from "@decaf-ts/core";
import { ModelSecretServiceConfig } from "./ModelSecretServiceConfig";
import { Condition } from "@decaf-ts/core";
import { CryptoService } from "@decaf-ts/crypto/integration/services";

const DEFAULT_KEY_ID = "default-key";

export class ModelSecretService extends ClientBasedService<Repository<Secret, any>, ModelSecretServiceConfig> {
  readonly provider: SecretProvider = "model";
  private cryptoService!: CryptoService;

  async initialize(...args: ContextualArgs<any>): Promise<{ config: ModelSecretServiceConfig; client: Repository<Secret, any> }> {
    const config = args[0] as ModelSecretServiceConfig;
    const repository = (args[1] as Repository<Secret, any> | undefined) || new Repository<Secret, any>(undefined, Secret);
    this.cryptoService = new CryptoService();
    await this.cryptoService.initialize(config);
    return { config, client: repository };
  }

  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log } = (await this.logCtx(args, "store", true)).for(this.store);
    log.verbose(`Storing secret ${name}`);
    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const serialized = serializeSecretPayload(value);
    const derivedKey = await this.cryptoService.deriveKeyFromSecret(this.config.keySecret as string);
    const { encryptedData, metadata } = await this.cryptoService.encryptPayload(
      serialized.value,
      this.config.keyId || DEFAULT_KEY_ID,
      this.cryptoService.extractKeyFromDerivedKey(derivedKey).key
    );

    const now = new Date();
    const secret = new Secret({
      name: normalizedName,
      provider: this.provider,
      encryptedPayload: encryptedData,
      encryption: {
        keyId: metadata.keyId,
        iv: metadata.iv,
      },
      contentType: options.contentType,
      tags: options.tags,
      enabled: true,
      version: options.version,
    });

    try {
      await this.client.create(secret);
    } catch (error: any) {
      if (error?.message?.toLowerCase()?.includes?.("already") || error?.name === "ConflictError") {
        throw this.parseError(error as Error);
      }
      throw this.parseError(error as Error);
    }

    return {
      provider: this.provider,
      name: normalizedName,
      version: options.version,
      metadata: {
        createdAt: now.toISOString(),
      },
    };
  }

  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options: RetrieveSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log } = (await this.logCtx(args, "retrieve", true)).for(this.retrieve);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Retrieving secret ${nameStr}`);

    let name: string;
    let version: string | undefined;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
      version = options.version;
    } else {
      name = nameOrRef.name;
      version = nameOrRef.version;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);

    let condition = Condition.attr<Secret>("name").eq(normalizedName);
    
    if (version) {
      condition = condition.and(Condition.attr<Secret>("version").eq(version));
    }
    
    condition = condition.and(Condition.attr<Secret>("enabled").eq(true));

    const results = await this.client.select().where(condition).execute();
    const existing = results[0];

    if (!existing) {
      throw this.parseError(
        new Error(`Secret "${normalizedName}" not found`)
      );
    }

    const derivedKey = await this.cryptoService.deriveKeyFromSecret(this.config.keySecret as string);
    let decryptedValue: string;
    try {
      decryptedValue = await this.cryptoService.decryptPayload(
        existing.encryptedPayload,
        this.cryptoService.extractKeyFromDerivedKey(derivedKey).key
      );
    } catch (error) {
      throw this.parseError(
        new Error(`Failed to decrypt secret "${normalizedName}": ${(error as Error).message}`)
      );
    }

    const payload: SerializedSecretPayload = {
      encoding: "utf8",
      value: decryptedValue,
    };

    return deserializeSecretPayload(payload) as T;
  }

  async delete(
    nameOrRef: SecretName | SecretReference,
    options: DeleteSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Deleting secret ${nameStr}`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);

    let filter = Condition.attr<Secret>("name").eq(normalizedName);
    const version = options.version;
    if (version) {
      filter = filter.and(Condition.attr<Secret>("version").eq(version));
    }

    const results = await this.client.select().where(filter).execute();
    const existing = results[0];

    if (!existing) {
      return;
    }

    if (options.force) {
      await this.client.delete(normalizedName);
    } else {
      existing.enabled = false;
      existing.updatedAt = new Date();
      await this.client.update(existing);
    }
  }

  async exists(
    nameOrRef: SecretName | SecretReference,
    options: ExistsSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "exists", true)).for(this.exists);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Checking if secret ${nameStr} exists`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);

    let filter = Condition.attr<Secret>("name").eq(normalizedName);
    filter = filter.and(Condition.attr<Secret>("enabled").eq(true));
    
    const version = options.version ?? (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
    if (version) {
      filter = filter.and(Condition.attr<Secret>("version").eq(version));
    }

    const count = await this.client
      .count()
      .where(filter)
      .execute();

    return count > 0;
  }

  async list(options: ListSecretsOptions = {}, ...args: MaybeContextualArg<any>): Promise<SecretMetadata[]> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing secrets");

    let condition: Condition<Secret> | null = null;

    if (options.enabled !== undefined) {
      condition = Condition.attr<Secret>("enabled").eq(options.enabled);
    }

    const secrets: Secret[] = await this.client
      .select()
      .where(condition || Condition.attr<Secret>("name").dif(null))
      .execute();

    return secrets.map((secret: Secret) => ({
      provider: secret.provider as SecretProvider,
      name: secret.name,
      version: secret.version,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      enabled: secret.enabled,
      contentType: secret.contentType,
      tags: secret.tags,
    }));
  }

  async metadata(
    nameOrRef: SecretName | SecretReference,
    options: SecretMetadataOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log } = (await this.logCtx(args, "metadata", true)).for(this.metadata);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Getting metadata for secret ${nameStr}`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);

    let filter = Condition.attr<Secret>("name").eq(normalizedName);
    
    const version = options.version ?? (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
    if (version) {
      filter = filter.and(Condition.attr<Secret>("version").eq(version));
    }

    const results: Secret[] = await this.client.select().where(filter).execute();
    const secret = results[0];

    if (!secret) {
      return undefined;
    }

    const meta: SecretMetadata = {
      provider: secret.provider as SecretProvider,
      name: secret.name,
      version: secret.version,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      enabled: secret.enabled,
      contentType: secret.contentType,
    };

    if (options.includeTags) {
      meta.tags = secret.tags;
    }

    return meta;
  }

  protected parseError(error: unknown): SecretError {
    const err = error as Error;
    const message = err.message || err.name || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new SecretError(
        "SECRET_NOT_FOUND",
        `Secret not found: ${message}`,
        err
      );
    }

    if (
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new SecretError(
        "SECRET_ALREADY_EXISTS",
        `Secret already exists: ${message}`,
        err
      );
    }

    if (lowerMessage.includes("decryption") || lowerMessage.includes("decrypt")) {
      return new SecretError(
        "SECRET_DECRYPTION_FAILED",
        `Decryption failed: ${message}`,
        err
      );
    }

    return new SecretError(
      "SECRET_PROVIDER_CONFLICT",
      `Provider error: ${message}`,
      err
    );
  }
}
