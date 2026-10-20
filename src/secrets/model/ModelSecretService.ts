/**
 * @module integrations/secrets/model/service
 * @summary Model-backed encrypted secret service.
 * @description Implements the `{@link ModelSecretService}`, a
 * `@service("secret-model")`-decorated `ClientBasedSecretService` that
 * persists AES-encrypted payloads as `{@link Secret}` rows through a
 * decaf `Repository` (tenant/org-unit/owner scoping included). Encryption
 * keys derive from a master `keySecret` via `CryptoService`; configuration
 * comes from the `secrets.model` Environment slice or an explicit boot
 * config (see `ModelSecretServiceConfig`). The non-Environment node
 * counterpart is `{@link ModelSecretNodeService}`.
 */
import { ClientBasedSecretService, SecretError, SecretProvider } from "../core";
import {
  SecretName,
  SecretPayload,
  SecretReference,
  SecretMetadata,
} from "../core";
import {
  StoreSecretOptions,
  RetrieveSecretOptions,
  DeleteSecretOptions,
  ExistsSecretOptions,
  ListSecretsOptions,
  SecretMetadataOptions,
  RotateSecretOptions,
} from "../core";
import { validateSecretName, normalizeSecretName } from "../core";
import {
  serializeSecretPayload,
  deserializeSecretPayload,
  type SerializedSecretPayload,
} from "../core";
import { Secret } from "./Secret";
import {
  Context,
  ContextLock,
  ContextualArgs,
  MaybeContextualArg,
  Repository,
  resolveTransactionLock,
  service,
} from "@decaf-ts/core";
import { ModelSecretServiceConfig } from "./ModelSecretServiceConfig";
import { ModelSecretEnvironment } from "./ModelSecretEnvironment";
import { envString } from "../../shared/environmentValue";
import { Condition, OrderDirection } from "@decaf-ts/core";
import { CryptoService } from "@decaf-ts/crypto/integration/services/crypto";
import { InternalError, NotFoundError } from "@decaf-ts/db-decorators";

const DEFAULT_KEY_ID = "default-key";

/**
 * @description Model-backed encrypted secret service
 * @summary Stores each secret as a `{@link Secret}` row (encrypted payload,
 * key id/iv/salt metadata, version, enablement flag, and optional
 * tenant/org-unit/owner scope) through the repository booted as the service
 * client. Names are validated and normalized before persistence;
 * `(name, version)` is unique (enforced by a `SECRET_ALREADY_EXISTS`
 * conflict in `store`/`rotate` and backed by the `uq_secrets_name_version`
 * database index); retrieval only considers enabled rows, supports version
 * pinning, and resolves multiple matches deterministically by `updatedAt
 * DESC`. Delete is soft by default (sets `enabled: false`) unless
 * `options.force` is set. Errors from the repository are translated into
 * typed {@link SecretError}s by `parseError`.
 *
 * Registered as `@service("secret-model")` and Environment-configurable
 * through the `secrets.model` slice; the credential service
 * (`CredentialService`) delegates user/runtime credential storage to this
 * service.
 * @class ModelSecretService
 * @category Secrets
 * @example
 * ```ts
 * import { ModelSecretService } from "@decaf-ts/integrations/secrets";
 *
 * const modelSecrets = await new ModelSecretService().boot({
 *   keySecret: "model-master-key",
 * });
 * await modelSecrets.store("my-secret", { value: "s3cr3t" });
 * const payload = await modelSecrets.retrieve<{ value: string }>("my-secret");
 * ```
 */
@service("secret-model")
export class ModelSecretService extends ClientBasedSecretService<
  Repository<Secret, any>,
  ModelSecretServiceConfig
> {
  readonly provider: SecretProvider = "model";
  private cryptoService!: CryptoService;

  constructor() {
    super();
  }

  /**
   * @description Builds the model secret configuration from the Environment
   * @summary Reads the `secrets.model` Environment slice and returns a
   * `ModelSecretServiceConfig` when a `keySecret` is configured; returns
   * `undefined` otherwise, letting boot fall back to explicit arguments.
   * @returns {ModelSecretServiceConfig | undefined} The Environment-derived configuration, or `undefined`.
   * @override
   */
  protected configFromEnvironment(): ModelSecretServiceConfig | undefined {
    const env = ModelSecretEnvironment.secrets.model;
    const keySecret = envString(env?.keySecret);
    if (!keySecret) return undefined;
    return {
      provider: "model",
      keySecret,
      keyId: envString(env.keyId),
    };
  }

  /**
   * @description Boots the crypto service and resolves the backing repository
   * @summary Accepts the configuration (explicit args, merged with the
   * Environment slice by the base) and an optional `Repository<Secret>` as the
   * second argument; when absent, creates one via `Repository.forModel(Secret)`.
   * Returns the config and repository as the service client.
   * @param {ContextualArgs} args - Configuration and optional `Repository`/`Context` arguments.
   * @returns {Promise<{config: ModelSecretServiceConfig, client: Repository<Secret, any>}>} The resolved config and repository client.
   */
  async initialize(...args: ContextualArgs<any>): Promise<{
    config: ModelSecretServiceConfig;
    client: Repository<Secret, any>;
  }> {
    const config = this.getConfigFromArgs<ModelSecretServiceConfig>(...args);
    const repository =
      (args[1] as Repository<Secret, any> | undefined) ||
      Repository.forModel<Secret, Repository<Secret, any>>(Secret);
    this.cryptoService = new CryptoService();
    await this.cryptoService.boot({});
    return { config, client: repository };
  }

  /**
   * @description Encrypts and persists a secret row
   * @summary Validates and normalizes the name, serializes the payload, and
   * encrypts it with a key derived from the master `keySecret`, embedding the
   * key id/iv/salt in the row's `encryption` metadata. The row carries the
   * optional tenant/org-unit/owner scoping and version. `(name, version)` is
   * unique: an application-level pre-check rejects a duplicate combination
   * with a `SECRET_ALREADY_EXISTS` {@link SecretError} before the insert, and
   * the `uq_secrets_name_version` database index (which treats `NULL`
   * versions as `''`) backstops the same rule against concurrent writers.
   * @template T - The secret payload type.
   * @param {SecretName} name - The secret name (validated and normalized).
   * @param {T} value - The payload to encrypt and store.
   * @param {StoreSecretOptions} [options] - Optional content type, tags, version, and tenant/org/owner scoping.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<SecretReference>} A reference to the persisted secret.
   * @throws {SecretError} `SECRET_ALREADY_EXISTS` when a row with the same normalized name and version already exists, or `SECRET_NOT_FOUND`/`SECRET_PROVIDER_CONFLICT` when the name is invalid or the repository insert fails.
   */
  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log, ctxArgs } = (await this.logCtx(args, "store", true)).for(
      this.store
    );
    log.verbose(`Storing secret ${name}`);
    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const serialized = serializeSecretPayload(value);
    const derivedKey = await this.cryptoService.deriveKeyFromSecret(
      this.config.keySecret as string
    );
    const extracted = this.cryptoService.extractKeyFromDerivedKey(derivedKey);
    const { encryptedData, metadata } = await this.cryptoService.encryptPayload(
      JSON.stringify(serialized),
      this.config.keyId || DEFAULT_KEY_ID,
      extracted.key
    );

    const now = new Date();
    const secret = new Secret({
      name: normalizedName,
      provider: this.provider,
      encryptedPayload: encryptedData,
      encryption: {
        keyId: metadata.keyId,
        iv: metadata.iv,
        salt: extracted.salt,
      },
      contentType: options.contentType,
      tags: options.tags,
      enabled: true,
      version: options.version,
      tenantId: options.tenantId,
      orgUnitId: options.orgUnitId,
      ownerPrincipalId: options.ownerPrincipalId,
    });

    const targetVersion = options.version ?? "";
    const existing = await this.client
      .select()
      .where(Condition.attr<Secret>("name").eq(normalizedName))
      .execute(...ctxArgs);
    const duplicate = existing.some(
      (row: Secret) => (row.version ?? "") === targetVersion
    );
    if (duplicate) {
      throw new SecretError(
        "SECRET_ALREADY_EXISTS",
        `Secret ${JSON.stringify(normalizedName)}${
          targetVersion ? ` version ${JSON.stringify(targetVersion)}` : ""
        } already exists`
      );
    }

    try {
      await this.client.create(secret, ...ctxArgs);
    } catch (error) {
      throw this.parseError(error);
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

  /**
   * @description Reads, decrypts, and deserializes an enabled secret row
   * @summary Queries the newest matching enabled row (by normalized name and,
   * optionally, version), re-derives the key using the row's salt, and decrypts
   * the payload. Rows are ordered by `updatedAt DESC`, so when several rows
   * share a name the most recently updated enabled row is resolved
   * deterministically. Missing rows throw {@link NotFoundError}; decryption
   * and JSON parse failures throw `InternalError`.
   * @template T - The secret payload type.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {RetrieveSecretOptions} [options] - Optional version filter.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<T>} The decrypted payload.
   * @throws {NotFoundError} When no enabled secret matches the name/version.
   */
  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options: RetrieveSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log, ctx, ctxArgs } = (
      await this.logCtx(args, "retrieve", true)
    ).for(this.retrieve);
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

    const results = await this.withinPrincipalTransaction(ctx, (lock) =>
      this.client
        .override({ transactionLock: lock })
        .select()
        .where(condition)
        .orderBy(["updatedAt", OrderDirection.DSC])
        .execute(...ctxArgs)
    );
    const existing = results[0];

    if (!existing) {
      throw new NotFoundError(`Secret "${normalizedName}" not found`);
    }

    const derivedKey = await this.cryptoService.deriveKeyFromSecret(
      this.config.keySecret as string,
      existing.encryption?.salt
    );
    let decryptedValue: string;
    try {
      decryptedValue = await this.cryptoService.decryptPayload(
        existing.encryptedPayload,
        this.cryptoService.extractKeyFromDerivedKey(derivedKey).key
      );
    } catch (error) {
      throw new InternalError(
        `Failed to decrypt secret "${normalizedName}": ${(error as Error).message}`
      );
    }

    let payload: SerializedSecretPayload;
    try {
      payload = JSON.parse(decryptedValue) as SerializedSecretPayload;
    } catch (error) {
      throw new InternalError(
        `Failed to deserialize secret "${normalizedName}": ${(error as Error).message}`
      );
    }

    return deserializeSecretPayload(payload) as T;
  }

  private async withinPrincipalTransaction<R>(
    context: Context<any>,
    operation: (lock: ContextLock) => Promise<R>
  ): Promise<R> {
    const existing = context.getOrUndefined("transactionLock") as
      | ContextLock
      | undefined;
    const lock = existing ?? resolveTransactionLock(this.client);
    lock.depth++;
    if (!existing) {
      await lock.begin(context);
      context.cache.put("transactionLock", lock);
    }
    let result: R;
    try {
      result = await operation(lock);
    } catch (error: unknown) {
      const alreadyEnded = lock.depth === 0;
      lock.depth = 0;
      if (!alreadyEnded) {
        try {
          await lock.rollback(error as Error, context);
        } catch (rollbackError: unknown) {
          void rollbackError;
        }
      }
      throw error;
    }
    lock.depth--;
    if (lock.depth === 0) {
      try {
        await lock.commit(context);
      } catch (error: unknown) {
        throw new InternalError(`Failed to commit transaction: ${error}`);
      }
    }
    return result;
  }

  /**
   * @description Deletes (or disables) a secret row
   * @summary Soft-deletes by default: the row is disabled and stamped with a
   * new `updatedAt`. With `options.force`, the row is hard-deleted from the
   * repository. Rows are ordered by `updatedAt DESC`, so the most recently
   * updated matching row is resolved deterministically. A missing secret
   * resolves silently.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {DeleteSecretOptions} [options] - Optional version filter and `force` hard-delete flag.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<void>} Resolves once the row is deleted or disabled.
   */
  async delete(
    nameOrRef: SecretName | SecretReference,
    options: DeleteSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = (await this.logCtx(args, "delete", true)).for(
      this.delete
    );
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

    const results = await this.client
      .select()
      .where(filter)
      .orderBy(["updatedAt", OrderDirection.DSC])
      .execute(...ctxArgs);
    const existing = results[0];

    if (!existing) {
      return;
    }

    if (options.force) {
      await this.client.delete(existing.id, ...ctxArgs);
    } else {
      existing.enabled = false;
      existing.updatedAt = new Date();
      await this.client.update(existing, ...ctxArgs);
    }
  }

  /**
   * @description Checks whether an enabled secret exists (optionally at a version)
   * @summary Counts enabled rows matching the normalized name (plus any
   * requested version) and returns whether the count is positive.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {ExistsSecretOptions} [options] - Optional version filter.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<boolean>} `true` when at least one enabled row matches.
   */
  async exists(
    nameOrRef: SecretName | SecretReference,
    options: ExistsSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log, ctxArgs } = (await this.logCtx(args, "exists", true)).for(
      this.exists
    );
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

    const version =
      options.version ??
      (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
    if (version) {
      filter = filter.and(Condition.attr<Secret>("version").eq(version));
    }

    const count = await this.client.count().where(filter).execute(...ctxArgs);

    return count > 0;
  }

  /**
   * @description Lists secret metadata across stored rows
   * @summary Selects rows filtered by the `enabled` flag (when supplied) and
   * maps them to `SecretMetadata` records (no payloads).
   * @param {ListSecretsOptions} [options] - Optional `enabled` filter.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<SecretMetadata[]>} Metadata for every matching secret.
   */
  async list(
    options: ListSecretsOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata[]> {
    const { log, ctxArgs } = (await this.logCtx(args, "list", true)).for(
      this.list
    );
    log.verbose("Listing secrets");

    let condition: Condition<Secret> | null = null;

    if (options.enabled !== undefined) {
      condition = Condition.attr<Secret>("enabled").eq(options.enabled);
    }

    const secrets: Secret[] = await this.client
      .select()
      .where(condition || Condition.attr<Secret>("name").dif(null))
      .execute(...ctxArgs);

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

  /**
   * @description Reads one secret's metadata without its payload
   * @summary Selects the row matching the normalized name (and optional
   * version) and maps it to `SecretMetadata`; tags are included only when
   * `options.includeTags` is set. Rows are ordered by `updatedAt DESC`, so
   * the most recently updated matching row is resolved deterministically.
   * Returns `undefined` when no row matches.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {SecretMetadataOptions} [options] - Optional version filter and `includeTags` flag.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<SecretMetadata | undefined>} The metadata, or `undefined` when absent.
   */
  async metadata(
    nameOrRef: SecretName | SecretReference,
    options: SecretMetadataOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log, ctxArgs } = (await this.logCtx(args, "metadata", true)).for(
      this.metadata
    );
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

    const version =
      options.version ??
      (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
    if (version) {
      filter = filter.and(Condition.attr<Secret>("version").eq(version));
    }

    const results: Secret[] = await this.client
      .select()
      .where(filter)
      .orderBy(["updatedAt", OrderDirection.DSC])
      .execute(...ctxArgs);
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

  /**
   * @description Re-encrypts an enabled secret row with a new payload
   * @summary Locates the enabled row (optionally pinned to
   * `options.oldVersion`), encrypts the new payload with a freshly derived
   * key (optionally tagged with `options.keyId`), and updates the row's
   * payload, encryption metadata, version (`options.newVersion`), and
   * `updatedAt`. When `options.newVersion` differs from the row's current
   * version, a `(name, version)` duplicate check rejects the rotation with a
   * `SECRET_ALREADY_EXISTS` {@link SecretError}; otherwise the target version
   * is reused and the row is updated in place. Matching rows are ordered by
   * `updatedAt DESC`, so the most recently updated enabled row is resolved
   * deterministically.
   * @template T - The secret payload type.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {T} value - The new payload.
   * @param {RotateSecretOptions} [options] - Optional `newVersion`, `oldVersion`, and `keyId`.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<SecretReference>} A reference reflecting the updated row.
   * @throws {NotFoundError} When no enabled secret matches the name/version.
   * @throws {SecretError} `SECRET_ALREADY_EXISTS` when the target `newVersion` is already held by another row with the same normalized name, or `SECRET_PROVIDER_CONFLICT` when the repository update fails.
   */
  async rotate<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    value: T,
    options: RotateSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log, ctxArgs } = (await this.logCtx(args, "rotate", true)).for(
      this.rotate
    );
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Rotating secret ${nameStr}`);

    const normalizedName = normalizeSecretName(nameStr);
    let condition = Condition.attr<Secret>("name").eq(normalizedName);
    condition = condition.and(Condition.attr<Secret>("enabled").eq(true));

    const version =
      options.oldVersion ??
      (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
    if (version) {
      condition = condition.and(Condition.attr<Secret>("version").eq(version));
    }

    const results = await this.client
      .select()
      .where(condition)
      .orderBy(["updatedAt", OrderDirection.DSC])
      .execute(...ctxArgs);
    const existing = results[0];

    if (!existing) {
      throw new NotFoundError(`Secret "${normalizedName}" not found`);
    }

    const nextVersion = options.newVersion ?? existing.version;
    const targetVersion = nextVersion ?? "";
    if (targetVersion !== (existing.version ?? "")) {
      const rows = await this.client
        .select()
        .where(Condition.attr<Secret>("name").eq(normalizedName))
        .execute(...ctxArgs);
      const duplicate = rows.some(
        (row: Secret) =>
          row.id !== existing.id && (row.version ?? "") === targetVersion
      );
      if (duplicate) {
        throw new SecretError(
          "SECRET_ALREADY_EXISTS",
          `Secret ${JSON.stringify(normalizedName)}${
            targetVersion ? ` version ${JSON.stringify(targetVersion)}` : ""
          } already exists`
        );
      }
    }

    const serialized = serializeSecretPayload(value);
    const derivedKey = await this.cryptoService.deriveKeyFromSecret(
      this.config.keySecret as string
    );
    const extracted = this.cryptoService.extractKeyFromDerivedKey(derivedKey);
    const { encryptedData, metadata } = await this.cryptoService.encryptPayload(
      JSON.stringify(serialized),
      options.keyId || this.config.keyId || DEFAULT_KEY_ID,
      extracted.key
    );

    existing.encryptedPayload = encryptedData;
    existing.encryption = {
      keyId: metadata.keyId,
      iv: metadata.iv,
      salt: extracted.salt,
    };
    existing.version = nextVersion;
    existing.updatedAt = new Date();

    try {
      await this.client.update(existing, ...ctxArgs);
    } catch (error) {
      throw this.parseError(error);
    }

    return {
      provider: this.provider,
      name: normalizedName,
      version: existing.version,
    };
  }

  /**
   * @description Translates repository errors into typed secret errors
   * @summary Inspects the error message for "not found"/404, "already
   * exists"/conflict/409, and decryption-related markers and maps them to
   * `SECRET_NOT_FOUND`, `SECRET_ALREADY_EXISTS`,
   * `SECRET_DECRYPTION_FAILED`, or a generic `SECRET_PROVIDER_CONFLICT`
   * {@link SecretError}.
   * @param {unknown} error - The raw error thrown by the repository.
   * @returns {SecretError} The typed secret error.
   */
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
      lowerMessage.includes("409") ||
      lowerMessage.includes("duplicate key") ||
      lowerMessage.includes("unique constraint") ||
      (err as { code?: unknown }).code === "23505"
    ) {
      return new SecretError(
        "SECRET_ALREADY_EXISTS",
        `Secret already exists: ${message}`,
        err
      );
    }

    if (
      lowerMessage.includes("decryption") ||
      lowerMessage.includes("decrypt")
    ) {
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
