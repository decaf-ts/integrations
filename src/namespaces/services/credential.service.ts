/**
 * @module integrations/namespaces/services/credential
 * @summary Namespaced credential management service backed by the model secret service.
 * @description Provides the `{@link CredentialService}`, which manages
 * `{@link Credential}` metadata rows and stores each credential's secret
 * value, encrypted, in the model-backed secret service (see
 * `{@link ModelSecretService}`). Secret names are generated internally
 * (`credential-<uuid>`) and never exposed; the credential row references the
 * secret by `secretName`. Also defines the {@link CredentialSecretStore}
 * contract and {@link CredentialServiceConfig} used to inject a custom
 * secret store or repository.
 */
import { randomUUID } from "node:crypto";
import { Repository } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import { ModelSecretService } from "../../secrets/model";
import {
  DeleteSecretOptions,
  ExistsSecretOptions,
  RotateSecretOptions,
  SecretName,
  SecretPayload,
  SecretProvider,
  SecretReference,
  StoreSecretOptions,
  normalizeSecretName,
} from "../../secrets/core";
import {
  CreateCredentialInput,
  CredentialProvider,
  CredentialSummary,
  RotateCredentialInput,
} from "../types";
import { BaseModelService, relationId } from "../utils";
import { Credential } from "../models/credential.model";

/**
 * @description Minimal secret-store contract required by the credential service
 * @summary Structural subset of the secret service API used for credential
 * values; `rotate` is optional — when absent, rotation falls back to a
 * re-store under the same secret name.
 */
export interface CredentialSecretStore {
  /** @description Fixed provider discriminator of the backing implementation. */
  readonly provider: SecretProvider;
  /** @description Stores (or overwrites) a named secret payload. */
  store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options?: StoreSecretOptions,
    ...args: any[]
  ): Promise<SecretReference>;
  /** @description Deletes a stored secret. */
  delete(
    nameOrRef: SecretName | SecretReference,
    options?: DeleteSecretOptions,
    ...args: any[]
  ): Promise<void>;
  /** @description Checks whether a secret exists. */
  exists(
    nameOrRef: SecretName | SecretReference,
    options?: ExistsSecretOptions,
    ...args: any[]
  ): Promise<boolean>;
  /** @description Optional in-place rotation of a stored secret value. */
  rotate?(
    nameOrRef: SecretName | SecretReference,
    value: SecretPayload,
    options?: RotateSecretOptions,
    ...args: any[]
  ): Promise<SecretReference>;
}

/**
 * @description Injection configuration for the credential service
 * @summary When `secretService` is omitted, the service lazily boots a
 * `{@link ModelSecretService}` on first use; when `repository` is omitted,
 * the base `BaseModelService` repository for `{@link Credential}` is used.
 */
export interface CredentialServiceConfig {
  /** @description Secret store for credential values (must have `provider: "model"`). */
  secretService?: CredentialSecretStore;
  /** @description Repository backing the `Credential` metadata rows. */
  repository?: Repository<Credential, any>;
}

/**
 * @description Manages namespaced credentials and their encrypted secret values
 * @summary Extends `BaseModelService<Credential>` to create, rotate, read,
 * list, use-mark, and delete credentials. On create, the secret value is
 * stored under a generated name first and the metadata row second; if the
 * row insert fails, the stored secret is force-deleted so no orphaned secret
 * remains. Deletion mirrors that: the row is removed, then the secret value.
 * The secret store must resolve to `provider: "model"` — user/runtime
 * credentials always live in the model-backed secret service.
 * @category Namespaces
 * @example
 * ```ts
 * import { CredentialService } from "@decaf-ts/integrations/namespaces";
 *
 * const credentials = new CredentialService();
 * const credential = await credentials.createCredential({
 *   tenantId: "tenant-1",
 *   name: "deploy-token",
 *   credentialType: "token",
 *   secret: { value: "s3cr3t" },
 * });
 * await credentials.rotateCredential({
 *   credentialId: credential.id,
 *   secret: { value: "n3w-s3cr3t" },
 * });
 * ```
 */
export class CredentialService extends BaseModelService<Credential> {
  private secretServiceInstance?: CredentialSecretStore;

  /**
   * @description Creates the credential service
   * @param {CredentialServiceConfig} [config] - Optional secret store and repository overrides.
   */
  constructor(config: CredentialServiceConfig = {}) {
    super(Credential);
    this.secretServiceInstance = config.secretService;
    if (config.repository) {
      this._repository = config.repository as any;
    }
  }

  /**
   * @description Resolves the model-backed secret store, booting one lazily
   * @summary Returns the injected secret service or lazily boots a fresh
   * `{@link ModelSecretService}`; rejects with a {@link ValidationError} when
   * the resolved store's provider is not `"model"`.
   * @returns {Promise<CredentialSecretStore>} The model-backed secret store.
   * @throws {ValidationError} When the injected store is not model-backed.
   */
  protected async secretService(): Promise<CredentialSecretStore> {
    let service = this.secretServiceInstance;
    if (!service) {
      const created = new ModelSecretService();
      await created.boot();
      this.secretServiceInstance = created;
      service = created;
    }
    if (service.provider !== "model") {
      throw new ValidationError(
        "CredentialService stores user/runtime credentials in the model-backed secret service"
      );
    }
    return service;
  }

  /**
   * @description Creates a credential row and stores its secret value
   * @summary Validates the name (trimmed, ≤255 chars, `[A-Za-z0-9][A-Za-z0-9._-]*`),
   * stores the secret under a generated `credential-<uuid>` name scoped to the
   * supplied tenant/org-unit/owner, then inserts the metadata row. If the row
   * insert fails, the just-stored secret is force-deleted before rethrowing.
   * @param {CreateCredentialInput} input - Credential definition (name, type, secret value, scoping, metadata).
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the store and repository.
   * @returns {Promise<Credential>} The persisted credential row.
   * @throws {ValidationError} When the name is invalid.
   */
  async createCredential(
    input: CreateCredentialInput,
    ...args: any[]
  ): Promise<Credential> {
    const { log, ctxArgs } = (
      await this.logCtx(args, "createCredential", true)
    ).for(this.createCredential);
    const name = input.name?.trim();
    if (!name || name.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new ValidationError(
        `Invalid credential name: ${JSON.stringify(input.name)}`
      );
    }
    log.verbose(`Creating credential ${name}`);
    const service = await this.secretService();
    const secretName = normalizeSecretName(`credential-${randomUUID()}`);
    const reference = await service.store(
      secretName,
      input.secret,
      {
        tenantId: input.tenantId,
        orgUnitId: input.orgUnitId,
        ownerPrincipalId: input.ownerPrincipalId,
      },
      ...ctxArgs
    );
    try {
      return await this.create(
        {
          tenant: input.tenantId,
          orgUnit: input.orgUnitId,
          owner: input.ownerPrincipalId,
          name,
          credentialType: input.credentialType,
          secretName: reference.name,
          provider: CredentialProvider.Model,
          description: input.description,
          metadata: input.metadata,
          expiresAt: input.expiresAt,
          enabled: true,
        } as Partial<Credential>,
        ...ctxArgs
      );
    } catch (error) {
      await service
        .delete(secretName, { force: true }, ...ctxArgs)
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * @description Replaces a credential's secret value
   * @summary Uses the backing store's `rotate` when available; otherwise
   * re-stores the value under the existing secret name with the supplied
   * version and the credential's tenant/org-unit/owner scoping. The
   * credential row's `updatedAt` is refreshed afterwards.
   * @param {RotateCredentialInput} input - Credential id, new secret value, and optional version.
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the store and repository.
   * @returns {Promise<Credential>} The updated credential row.
   */
  async rotateCredential(
    input: RotateCredentialInput,
    ...args: any[]
  ): Promise<Credential> {
    const { log, ctxArgs } = (
      await this.logCtx(args, "rotateCredential", true)
    ).for(this.rotateCredential);
    log.verbose(`Rotating credential ${input.credentialId}`);
    const existing = await this.repo.read(input.credentialId, ...ctxArgs);
    const service = await this.secretService();
    if (service.rotate) {
      await service.rotate(
        existing.secretName,
        input.secret,
        { newVersion: input.version },
        ...ctxArgs
      );
    } else {
      await service.store(
        existing.secretName,
        input.secret,
        {
          version: input.version,
          tenantId: relationId(existing.tenant),
          orgUnitId: existing.orgUnit
            ? relationId(existing.orgUnit)
            : undefined,
          ownerPrincipalId: existing.owner
            ? relationId(existing.owner)
            : undefined,
        },
        ...ctxArgs
      );
    }
    existing.updatedAt = new Date();
    return this.repo.update(existing, ...ctxArgs);
  }

  /**
   * @description Reads a credential row by id
   * @param {string} credentialId - The credential id.
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<Credential>} The credential row.
   */
  async getCredential(
    credentialId: string,
    ...args: any[]
  ): Promise<Credential> {
    const { log, ctxArgs } = (await this.logCtx(args, "getCredential", true)).for(
      this.getCredential
    );
    log.verbose(`Reading credential ${credentialId}`);
    return this.repo.read(credentialId, ...ctxArgs);
  }

  /**
   * @description Lists all credentials as summaries (no secret material)
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<CredentialSummary[]>} Summary records for every credential.
   */
  async listCredentials(...args: any[]): Promise<CredentialSummary[]> {
    const { log, ctxArgs } = (
      await this.logCtx(args, "listCredentials", true)
    ).for(this.listCredentials);
    log.verbose("Listing credentials");
    const credentials: Credential[] = await this.repo
      .select()
      .execute(...ctxArgs);
    return credentials.map((credential) => this.toSummary(credential));
  }

  /**
   * @description Stamps a credential's `lastUsedAt` timestamp
   * @param {string} credentialId - The credential id.
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the repository.
   * @returns {Promise<Credential>} The updated credential row.
   */
  async markCredentialUsed(
    credentialId: string,
    ...args: any[]
  ): Promise<Credential> {
    const { log, ctxArgs } = (
      await this.logCtx(args, "markCredentialUsed", true)
    ).for(this.markCredentialUsed);
    log.verbose(`Marking credential ${credentialId} as used`);
    const existing = await this.repo.read(credentialId, ...ctxArgs);
    existing.lastUsedAt = new Date();
    return this.repo.update(existing, ...ctxArgs);
  }

  /**
   * @description Deletes a credential row and its stored secret value
   * @summary Removes the metadata row first, then force-deletes the
   * referenced secret from the backing store.
   * @param {string} credentialId - The credential id.
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the repository and store.
   * @returns {Promise<void>} Resolves once the row and secret are removed.
   */
  async deleteCredential(
    credentialId: string,
    ...args: any[]
  ): Promise<void> {
    const { log, ctxArgs } = (
      await this.logCtx(args, "deleteCredential", true)
    ).for(this.deleteCredential);
    log.verbose(`Deleting credential ${credentialId}`);
    const existing = await this.repo.read(credentialId, ...ctxArgs);
    await this.repo.delete(credentialId, ...ctxArgs);
    const service = await this.secretService();
    await service.delete(existing.secretName, { force: true }, ...ctxArgs);
  }

  /**
   * @description Maps a credential row to its API summary shape
   * @summary Resolves tenant/org-unit/owner relations to their ids and strips
   * all secret material (the secret value is never exposed).
   * @param {Credential} credential - The credential row.
   * @returns {CredentialSummary} The summary record.
   */
  private toSummary(credential: Credential): CredentialSummary {
    return {
      id: credential.id,
      tenantId: relationId(credential.tenant),
      orgUnitId: credential.orgUnit
        ? relationId(credential.orgUnit)
        : undefined,
      ownerPrincipalId: credential.owner
        ? relationId(credential.owner)
        : undefined,
      name: credential.name,
      credentialType: credential.credentialType,
      provider: credential.provider,
      description: credential.description,
      enabled: credential.enabled,
      metadata: credential.metadata,
      expiresAt: credential.expiresAt,
      lastUsedAt: credential.lastUsedAt,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
