/**
 * @module integrations/secrets/infra-credential-bootstrap
 * @summary Idempotent seeding of infrastructure credentials into a secret store.
 * @description Provides the minimal {@link InfraSecretStore} contract consumed
 * by {@link InfraCredentialBootstrap}, the {@link InfraCredentialSeed} input
 * shape, and the `createInfraCredentialBootstrap` factory that wires the
 * bootstrap to a booted `{@link FsSecretService}`. Intended for startup
 * routines that must guarantee a known set of credentials (for example the
 * Mailpit SMTP credentials) exists before services boot against them.
 */
import type {
  DeleteSecretOptions,
  ExistsSecretOptions,
  RetrieveSecretOptions,
  SecretName,
  SecretPayload,
  SecretReference,
  StoreSecretOptions,
} from "./core";
import { FsSecretService } from "./fs";

/**
 * @description Minimal secret-store contract required by the credential bootstrap
 * @summary Structural subset of the secret service API (`store`, `retrieve`,
 * `delete`, `exists`) so any backend — including test doubles — can back the
 * bootstrap without importing the full service hierarchy.
 */
export interface InfraSecretStore {
  /** @description Stores (or overwrites) a named secret payload. */
  store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options?: StoreSecretOptions,
    ...args: any[]
  ): Promise<SecretReference>;
  /** @description Reads and decrypts a stored secret payload. */
  retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options?: RetrieveSecretOptions,
    ...args: any[]
  ): Promise<T>;
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
}

/**
 * @description One credential to guarantee existence of in the secret store
 * @summary `overwrite: false` (the default) makes `ensure` skip seeds whose
 * name already exists, keeping stored values stable across restarts.
 */
export interface InfraCredentialSeed {
  /** @description Secret name to seed (normalized by the backing store). */
  name: SecretName;
  /** @description Payload to store. */
  value: SecretPayload;
  /** @description Optional content type recorded with the secret. */
  contentType?: string;
  /** @description Optional tags recorded with the secret. */
  tags?: Record<string, string>;
  /** @description When `true`, re-store (overwrite) even if the secret already exists. */
  overwrite?: boolean;
}

/**
 * @description Idempotent infrastructure credential seeder
 * @summary Wraps an {@link InfraSecretStore} and guarantees a set of named
 * credentials exists: `ensure` stores each missing seed (skipping existing
 * ones unless `overwrite` is set), `retrieve` reads one back. References
 * returned by `ensure` identify the stored secrets for later cleanup.
 * @category Secrets
 * @example
 * ```ts
 * import { createInfraCredentialBootstrap } from "@decaf-ts/integrations/secrets";
 *
 * const bootstrap = await createInfraCredentialBootstrap({
 *   keySecret: "master-key",
 * });
 * await bootstrap.ensure([
 *   { name: "smtp-user", value: { value: "mailpit" } },
 * ]);
 * ```
 */
export class InfraCredentialBootstrap {
  /**
   * @description Creates a bootstrap bound to the given secret store
   * @param {InfraSecretStore} service - The backing secret store (typically an `FsSecretService`).
   */
  constructor(readonly service: InfraSecretStore) {}

  /**
   * @description Ensures every seed exists in the backing store
   * @summary For each seed, skips when the secret already exists and
   * `overwrite` is not set; otherwise stores it and collects the returned
   * references. Existing-but-skipped seeds contribute no reference.
   * @param {readonly InfraCredentialSeed[]} seeds - The credentials to guarantee.
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the store.
   * @returns {Promise<SecretReference[]>} References for the seeds actually stored during this call.
   */
  async ensure(
    seeds: readonly InfraCredentialSeed[],
    ...args: any[]
  ): Promise<SecretReference[]> {
    const references: SecretReference[] = [];
    for (const seed of seeds) {
      const exists = await this.service.exists(seed.name, {}, ...args);
      if (exists && !seed.overwrite) continue;
      references.push(
        await this.service.store(
          seed.name,
          seed.value,
          { contentType: seed.contentType, tags: seed.tags },
          ...args
        )
      );
    }
    return references;
  }

  /**
   * @description Retrieves a previously seeded credential payload
   * @summary Thin wrapper over the backing store's `retrieve`, resolving
   * through the bootstrap's store so callers do not need the service instance.
   * @template T - The expected payload type.
   * @param {SecretName} name - The secret name to read.
   * @param {any[]} args - Optional trailing decaf `Context` forwarded to the store.
   * @returns {Promise<T>} The decrypted payload.
   */
  async retrieve<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    ...args: any[]
  ): Promise<T> {
    return this.service.retrieve<T>(name, {}, ...args);
  }
}

/**
 * @description Creates a bootstrap wired to a freshly booted filesystem secret service
 * @summary Constructs an `{@link FsSecretService}`, boots it with the supplied
 * arguments (explicit config or the `secrets.fs` Environment slice), and wraps
 * it in an {@link InfraCredentialBootstrap}.
 * @param {any[]} args - `boot()` arguments forwarded to the `FsSecretService` (config and optional `Context`).
 * @returns {Promise<InfraCredentialBootstrap>} The bootstrap backed by the booted service.
 */
export async function createInfraCredentialBootstrap(
  ...args: any[]
): Promise<InfraCredentialBootstrap> {
  const service = new FsSecretService();
  await service.boot(...args);
  return new InfraCredentialBootstrap(service);
}
