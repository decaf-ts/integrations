/**
 * @module integrations/secrets/fs/service
 * @summary Filesystem-backed encrypted secret service.
 * @description Implements the {@link FsSecretService}, an undecorated
 * `ClientBasedSecretService` that stores secrets as AES-encrypted JSON envelopes
 * (schema `decaf.fs-secret.v1`) under a 0o700 private root directory. Encryption
 * keys are derived from a master `keySecret` via `CryptoService`; every secret is
 * encrypted with the key id recorded in the envelope and a per-secret salt, so
 * rotation of the master key material is supported. Configuration comes from the
 * `secrets.fs` Environment slice or an explicit boot config (see
 * {@link FsSecretServiceConfig}).
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant FS as FsSecretService
 *   participant Crypto as CryptoService
 *   participant Disk as rootPath/*.json
 *   Caller->>FS: boot({ keySecret, rootPath? })
 *   activate FS
 *   FS->>Disk: mkdir(rootPath, 0o700)
 *   FS->>Crypto: boot({})
 *   Caller->>FS: store(name, payload)
 *   FS->>Crypto: deriveKeyFromSecret(keySecret)
 *   FS->>Crypto: encryptPayload(serialized, keyId, key)
 *   FS->>Disk: write envelope (temp + rename, 0o600)
 *   FS-->>Caller: SecretReference
 *   Caller->>FS: retrieve(name)
 *   FS->>Disk: read envelope
 *   FS->>Crypto: deriveKeyFromSecret(keySecret, salt)
 *   FS->>Crypto: decryptPayload(payload, key)
 *   FS-->>Caller: SecretPayload
 *   deactivate FS
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ContextualArgs,
  MaybeContextualArg,
} from "@decaf-ts/core";
import { InternalError, NotFoundError, ValidationError } from "@decaf-ts/db-decorators";
import { CryptoService } from "@decaf-ts/crypto/integration/services/crypto";
import {
  ClientBasedSecretService,
  DeleteSecretOptions,
  ExistsSecretOptions,
  ListSecretsOptions,
  RetrieveSecretOptions,
  RotateSecretOptions,
  SecretError,
  SecretMetadata,
  SecretMetadataOptions,
  SecretName,
  SecretPayload,
  SecretProvider,
  SecretReference,
  StoreSecretOptions,
  deserializeSecretPayload,
  normalizeSecretName,
  serializeSecretPayload,
  type SerializedSecretPayload,
} from "../core";
import { envString } from "../../shared/environmentValue";
import {
  DEFAULT_FS_SECRET_KEY_ID,
  DEFAULT_FS_SECRET_ROOT,
  FsSecretServiceConfig,
} from "./FsSecretServiceConfig";
import { FsSecretEnvironment } from "./FsSecretEnvironment";

interface FsSecretEnvelope {
  schema: "decaf.fs-secret.v1";
  name: string;
  provider: "filesystem";
  createdAt: string;
  updatedAt: string;
  contentType?: string;
  tags?: Record<string, string>;
  version?: string;
  encryption: {
    keyId: string;
    iv: string;
    salt: string;
  };
  payload: string;
}

/**
 * @description Filesystem-backed encrypted secret service
 * @summary Stores each secret as an isolated JSON envelope file
 * (`<normalizedName>.json`) inside a private root directory (default
 * `.decaf/secrets`, mode `0o700`; envelope files are written with mode
 * `0o600` through a temp-file-then-rename cycle). The master `keySecret` is
 * required — boot fails with a {@link ValidationError} when neither the
 * `secrets.fs.keySecret` Environment slice nor an explicit config supplies
 * it. Listing and per-secret metadata are intentionally unsupported and
 * throw a `SECRET_UNSUPPORTED_OPERATION` {@link SecretError}, because the
 * filesystem store is designed as a minimal bootstrap sink (see
 * {@link InfraCredentialBootstrap}).
 *
 * Configuration is resolved from the `secrets.fs` slice or an explicit boot
 * config.
 * @class FsSecretService
 * @category Secrets
 * @example
 * ```ts
 * import { FsSecretService } from "@decaf-ts/integrations/secrets";
 *
 * const fsSecrets = await new FsSecretService().boot({
 *   keySecret: "master-key",
 * });
 * await fsSecrets.store("my-secret", { value: "s3cr3t" });
 * const payload = await fsSecrets.retrieve<{ value: string }>("my-secret");
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant FS as FsSecretService
 *   participant Disk as rootPath/*.json
 *   Caller->>FS: store(name, value)
 *   activate FS
 *   FS->>FS: normalize + serialize + encrypt
 *   FS->>Disk: writeEnvelope (temp + rename, 0o600)
 *   FS-->>Caller: SecretReference
 *   Caller->>FS: retrieve(nameOrRef)
 *   FS->>Disk: readEnvelope
 *   alt missing file
 *     FS--xCaller: NotFoundError
 *   else version mismatch
 *     FS--xCaller: NotFoundError
 *   else decrypt/parse failure
 *     FS--xCaller: SecretError
 *   else success
 *     FS-->>Caller: SecretPayload
 *   end
 *   deactivate FS
 */
export class FsSecretService extends ClientBasedSecretService<
  void,
  FsSecretServiceConfig
> {
  readonly provider: SecretProvider = "filesystem";
  private cryptoService?: CryptoService;

  constructor() {
    super();
  }

  /**
   * @description Builds the filesystem secret configuration from the Environment
   * @summary Reads the `secrets.fs` Environment slice and returns a
   * {@link FsSecretServiceConfig} when a `keySecret` is configured, applying the
   * default root path and key id otherwise; returns `undefined` when the slice
   * carries no `keySecret`, letting boot fall back to explicit arguments.
   * @returns {FsSecretServiceConfig | undefined} The Environment-derived configuration, or `undefined`.
   * @override
   */
  protected configFromEnvironment(): FsSecretServiceConfig | undefined {
    const env = FsSecretEnvironment.secrets.fs;
    const keySecret = envString(env?.keySecret);
    if (!keySecret) return undefined;
    return {
      provider: "filesystem",
      rootPath: envString(env.rootPath) ?? DEFAULT_FS_SECRET_ROOT,
      keySecret,
      keyId: envString(env.keyId),
    };
  }

  /**
   * @description Creates the private store directory and the crypto service
   * @summary Resolves the configuration (Environment slice merged with explicit
   * args), requires a `keySecret`, resolves and creates `rootPath` with mode
   * `0o700`, and boots a fresh `CryptoService`. Returns the resolved config with
   * a `void` client (no external connection is needed).
   * @param {ContextualArgs} args - Optional decaf `Context`/configuration arguments.
   * @returns {Promise<{config: FsSecretServiceConfig, client: void}>} The resolved configuration and a `void` client.
   * @throws {ValidationError} When no `keySecret` is available from Environment or arguments.
   */
  async initialize(...args: ContextualArgs<any>): Promise<{
    config: FsSecretServiceConfig;
    client: void;
  }> {
    const { log } = (await this.logCtx(args, "initialize", true)).for(
      this.initialize
    );
    const fromArgs = this.getConfigFromArgs<FsSecretServiceConfig>(...args);
    const keySecret = envString(fromArgs.keySecret);
    if (!keySecret) {
      throw new ValidationError(
        "Filesystem secret service requires an encryption keySecret (secrets.fs.keySecret)"
      );
    }
    const config: FsSecretServiceConfig = {
      provider: "filesystem",
      rootPath: path.resolve(
        envString(fromArgs.rootPath) ?? DEFAULT_FS_SECRET_ROOT
      ),
      keySecret,
      keyId: envString(fromArgs.keyId) ?? DEFAULT_FS_SECRET_KEY_ID,
    };
    await fs.mkdir(config.rootPath, { recursive: true, mode: 0o700 });
    this.cryptoService = new CryptoService();
    await this.cryptoService.boot({});
    log.verbose(`Initialized filesystem secret store at ${config.rootPath}`);
    return { config, client: undefined };
  }

  /**
   * @description Encrypts and writes a secret envelope to the store
   * @summary Normalizes the name, serializes the payload, derives the
   * encryption key from the master `keySecret`, encrypts with the configured
   * key id, and atomically writes the envelope file. Versioning is expressed
   * through the envelope's `version` field.
   * @template T - The secret payload type.
   * @param {SecretName} name - The secret name (normalized before use).
   * @param {T} value - The payload to encrypt and store.
   * @param {StoreSecretOptions} [options] - Optional content type, tags, and version.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<SecretReference>} A reference pointing at the envelope file.
   */
  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log } = (await this.logCtx(args, "store", true)).for(this.store);
    log.verbose(`Storing filesystem secret ${name}`);
    const normalizedName = normalizeSecretName(name);
    const serialized = serializeSecretPayload(value);
    const derivedKey = await this.crypto.deriveKeyFromSecret(
      this.config.keySecret
    );
    const extracted = this.crypto.extractKeyFromDerivedKey(derivedKey);
    const { encryptedData, metadata } = await this.crypto.encryptPayload(
      JSON.stringify(serialized),
      this.config.keyId ?? DEFAULT_FS_SECRET_KEY_ID,
      extracted.key
    );
    const now = new Date().toISOString();
    const envelope: FsSecretEnvelope = {
      schema: "decaf.fs-secret.v1",
      name: normalizedName,
      provider: "filesystem",
      createdAt: now,
      updatedAt: now,
      contentType: options.contentType,
      tags: options.tags,
      version: options.version,
      encryption: {
        keyId: metadata.keyId,
        iv: metadata.iv,
        salt: extracted.salt,
      },
      payload: encryptedData,
    };
    await this.writeEnvelope(normalizedName, envelope);
    return {
      provider: this.provider,
      name: normalizedName,
      version: options.version,
      path: this.fileFor(normalizedName),
    };
  }

  /**
   * @description Reads, decrypts, and deserializes a stored secret
   * @summary Loads the envelope, validates the requested version when one is
   * supplied (either via options or the reference), re-derives the key using the
   * envelope salt, and decrypts the payload. Failures surface as
   * `SECRET_DECRYPTION_FAILED`/`SECRET_DESERIALIZATION_FAILED`
   * {@link SecretError}s; a missing envelope throws {@link NotFoundError}.
   * @template T - The secret payload type.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {RetrieveSecretOptions} [options] - Optional version filter.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<T>} The decrypted payload.
   * @throws {NotFoundError} When the secret (or requested version) does not exist.
   * @throws {SecretError} On decryption or deserialization failures.
   */
  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options: RetrieveSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log } = (await this.logCtx(args, "retrieve", true)).for(
      this.retrieve
    );
    const name = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Retrieving filesystem secret ${name}`);
    const normalizedName = normalizeSecretName(name);
    const envelope = await this.readEnvelope(normalizedName);
    const version =
      options.version ??
      (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
    if (version && envelope.version && version !== envelope.version) {
      throw new NotFoundError(
        `Secret "${normalizedName}" version "${version}" not found`
      );
    }
    const derivedKey = await this.crypto.deriveKeyFromSecret(
      this.config.keySecret,
      envelope.encryption.salt
    );
    let decrypted: string;
    try {
      decrypted = await this.crypto.decryptPayload(
        envelope.payload,
        this.crypto.extractKeyFromDerivedKey(derivedKey).key
      );
    } catch (error) {
      throw new SecretError(
        "SECRET_DECRYPTION_FAILED",
        `Failed to decrypt secret "${normalizedName}": ${(error as Error).message}`,
        error as Error
      );
    }
    let serialized: SerializedSecretPayload;
    try {
      serialized = JSON.parse(decrypted) as SerializedSecretPayload;
    } catch (error) {
      throw new SecretError(
        "SECRET_DESERIALIZATION_FAILED",
        `Failed to deserialize secret "${normalizedName}": ${(error as Error).message}`,
        error as Error
      );
    }
    return deserializeSecretPayload(serialized) as T;
  }

  /**
   * @description Removes the envelope file for a secret
   * @summary Deletes `<name>.json` from the root path (`force: true`, so a
   * missing file is not an error); a filesystem failure surfaces as a
   * `SECRET_PROVIDER_UNAVAILABLE` {@link SecretError}.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {DeleteSecretOptions} [options] - Unused; accepted for interface parity.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<void>} Resolves once the file is removed.
   * @throws {SecretError} When the file cannot be deleted.
   */
  async delete(
    nameOrRef: SecretName | SecretReference,
    options: DeleteSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    const name = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Deleting filesystem secret ${name}`);
    const normalizedName = normalizeSecretName(name);
    const file = this.fileFor(normalizedName);
    void options;
    try {
      await fs.rm(file, { force: true });
    } catch (error) {
      throw new SecretError(
        "SECRET_PROVIDER_UNAVAILABLE",
        `Failed to delete secret "${normalizedName}": ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * @description Checks whether a secret exists (optionally at a specific version)
   * @summary Reads the envelope and compares the requested version, if any,
   * against the stored one; a {@link NotFoundError} from the read maps to
   * `false`.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {ExistsSecretOptions} [options] - Optional version filter.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<boolean>} `true` when the secret exists and matches the version, if given.
   */
  async exists(
    nameOrRef: SecretName | SecretReference,
    options: ExistsSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "exists", true)).for(this.exists);
    const name = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Checking if filesystem secret ${name} exists`);
    const normalizedName = normalizeSecretName(name);
    try {
      const envelope = await this.readEnvelope(normalizedName);
      const version =
        options.version ??
        (typeof nameOrRef === "object" ? nameOrRef.version : undefined);
      return version ? envelope.version === version : true;
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
  }

  /**
   * @description Unsupported: the filesystem store does not expose listings
   * @summary Always throws to keep the filesystem sink minimal; use
   * {@link InfraCredentialBootstrap} to track seeded references instead.
   * @param {ListSecretsOptions} [options] - Unused.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<SecretMetadata[]>} Never resolves.
   * @throws {SecretError} Always, with `SECRET_UNSUPPORTED_OPERATION`.
   */
  async list(
    options: ListSecretsOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata[]> {
    (await this.logCtx(args, "list", true)).for(this.list);
    void options;
    throw new SecretError(
      "SECRET_UNSUPPORTED_OPERATION",
      "Filesystem secret service does not expose secret listings"
    );
  }

  /**
   * @description Unsupported: the filesystem store does not expose metadata
   * @summary Always throws; metadata is embedded in the envelope, which callers
   * are not expected to read directly.
   * @param {SecretName | SecretReference} nameOrRef - Unused.
   * @param {SecretMetadataOptions} [options] - Unused.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<SecretMetadata | undefined>} Never resolves.
   * @throws {SecretError} Always, with `SECRET_UNSUPPORTED_OPERATION`.
   */
  async metadata(
    nameOrRef: SecretName | SecretReference,
    options: SecretMetadataOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    (await this.logCtx(args, "metadata", true)).for(this.metadata);
    void options;
    throw new SecretError(
      "SECRET_UNSUPPORTED_OPERATION",
      "Filesystem secret service does not expose secret metadata"
    );
  }

  /**
   * @description Overwrites a secret with a new payload and version
   * @summary Re-stores the secret under the same normalized name, tagging the
   * new envelope with `options.newVersion` (the old envelope file is replaced).
   * @template T - The secret payload type.
   * @param {SecretName | SecretReference} nameOrRef - The secret name or reference.
   * @param {T} value - The new payload.
   * @param {RotateSecretOptions} [options] - Optional `newVersion` tag.
   * @param {MaybeContextualArg} args - Optional trailing decaf `Context`.
   * @returns {Promise<SecretReference>} A reference to the rewritten envelope.
   */
  async rotate<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    value: T,
    options: RotateSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const name = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    return this.store(
      name,
      value,
      { version: options.newVersion },
      ...args
    );
  }

  /**
   * @description Lazily resolves the booted `CryptoService`
   * @summary Throws an {@link InternalError} when accessed before
   * `initialize()`/`boot()`, which is the only way the crypto service is
   * created.
   * @returns {CryptoService} The booted crypto service.
   * @throws {InternalError} When the service is not initialized.
   */
  private get crypto(): CryptoService {
    if (!this.cryptoService) {
      throw new InternalError("Filesystem secret service is not initialized");
    }
    return this.cryptoService;
  }

  /**
   * @description Resolves the envelope file path for a normalized secret name
   * @param {string} name - The normalized secret name.
   * @returns {string} The absolute envelope path inside the configured root.
   */
  private fileFor(name: string): string {
    return path.join(this.config.rootPath, `${name}.json`);
  }

  /**
   * @description Reads and parses an envelope file
   * @summary A missing file maps to {@link NotFoundError}; filesystem failures
   * surface as `SECRET_PROVIDER_UNAVAILABLE` and JSON parse failures as
   * `SECRET_DESERIALIZATION_FAILED` {@link SecretError}s.
   * @param {string} name - The normalized secret name.
   * @returns {Promise<FsSecretEnvelope>} The parsed envelope.
   * @throws {NotFoundError} When the envelope file does not exist.
   * @throws {SecretError} On read or parse failures.
   */
  private async readEnvelope(name: string): Promise<FsSecretEnvelope> {
    const file = this.fileFor(name);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        throw new NotFoundError(`Secret "${name}" not found`);
      }
      throw new SecretError(
        "SECRET_PROVIDER_UNAVAILABLE",
        `Failed to read secret "${name}": ${(error as Error).message}`,
        error as Error
      );
    }
    try {
      return JSON.parse(raw) as FsSecretEnvelope;
    } catch (error) {
      throw new SecretError(
        "SECRET_DESERIALIZATION_FAILED",
        `Failed to parse secret "${name}": ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * @description Atomically writes an envelope file with private permissions
   * @summary Writes to a UUID-suffixed temp file with mode `0o600`, then
   * renames it over the target and re-applies the mode; on failure the temp
   * file is removed and a `SECRET_PROVIDER_UNAVAILABLE` {@link SecretError} is
   * thrown.
   * @param {string} name - The normalized secret name.
   * @param {FsSecretEnvelope} envelope - The envelope to persist.
   * @returns {Promise<void>} Resolves once the envelope is durably written.
   * @throws {SecretError} When the write/rename cycle fails.
   */
  private async writeEnvelope(
    name: string,
    envelope: FsSecretEnvelope
  ): Promise<void> {
    const target = this.fileFor(name);
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(envelope), { mode: 0o600 });
      await fs.chmod(temp, 0o600);
      await fs.rename(temp, target);
      await fs.chmod(target, 0o600);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw new SecretError(
        "SECRET_PROVIDER_UNAVAILABLE",
        `Failed to write secret "${name}": ${(error as Error).message}`,
        error as Error
      );
    }
  }
}
