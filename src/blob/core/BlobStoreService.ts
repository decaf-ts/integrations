/**
 * @module integrations/blob/core/service
 * @summary Blob store service abstraction.
 * @description Base abstraction for binary large object backends.
 */
import {
  ClientBasedService,
  type ContextualArgs,
  type MaybeContextualArg,
} from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import { cleanKey, physicalKey } from "./BlobKey";
import type {
  BlobGetOptions,
  BlobGetResult,
  BlobKey,
  BlobListOptions,
  BlobListResult,
  BlobMetadata,
  BlobProvider,
  BlobPutOptions,
  BlobPutResult,
  BlobStoreServiceConfig,
  BlobUrlOptions,
  BlobUrlResult,
  BlobValue,
} from "./BlobTypes";

/**
 * @description Base abstraction for blob store client services
 * @summary Provides the shared key handling, URI composition, and
 * auto-boot-aware config resolution used by every provider backend
 * (memory, local filesystem, S3-compatible, Azure Blob, GCS, IPFS).
 *
 * Extends {@link ClientBasedService} so concrete providers are registered as
 * injectable services and auto-booted by `Service.boot`. During auto-boot the
 * framework passes a decaf `Context` instead of a blob config, so
 * {@link BlobStoreService.getConfigFromArgs} must distinguish the two: a real
 * config always carries a non-empty string `provider`, while a `Context` does
 * not. When neither an explicit config nor the provider's environment slice
 * resolves a config, a context-bearing auto-boot is skipped via
 * {@link BlobStoreService.skipInitialization} instead of throwing, so optional
 * providers (e.g. `blob-minio`/`blob-r2` registered alongside `blob-s3`) do not
 * block the rest of the service graph. An explicit `initialize()` call with no
 * resolvable config still fails loudly with a {@link ValidationError}.
 *
 * @template TClient - The provider-specific client type created by `initialize`
 * @template TConfig - The provider-specific config extending {@link BlobStoreServiceConfig}
 * @class BlobStoreService
 * @memberOf module:integrations/blob/core/service
 */
export abstract class BlobStoreService<
  TClient = unknown,
  TConfig extends BlobStoreServiceConfig = BlobStoreServiceConfig,
> extends ClientBasedService<TClient, TConfig> {
  /**
   * @description Initializes the base service
   * @summary Delegates to {@link ClientBasedService}; config and client are
   * only set by a successful `initialize()` (or skipped on auto-boot).
   */
  constructor() {
    super();
  }

  /**
   * @description The blob provider identifier for this service
   * @summary Reads `provider` from the resolved config.
   * @return {BlobProvider} The provider identifier (e.g. `"s3"`, `"memory"`)
   * @throws {InternalError} If accessed before a successful `initialize()`
   */
  get provider(): BlobProvider {
    return this.config.provider;
  }

  /**
   * @description The logical source identifier for this service
   * @summary Reads `sourceId` from the resolved config; used to compose blob URIs.
   * @return {string} The configured source identifier
   * @throws {InternalError} If accessed before a successful `initialize()`
   */
  get sourceId(): string {
    return this.config.sourceId;
  }

  /**
   * @description Initializes the provider client from config or environment
   * @summary Concrete providers resolve their config via
   * {@link BlobStoreService.getConfigFromArgs}, build the provider client, and
   * store both on `_config`/`_client`. When no config can be resolved during a
   * context-bearing auto-boot, providers return
   * {@link BlobStoreService.skipInitialization} instead of throwing.
   * @param {...ContextualArg<any>} args - An optional blob config, optionally followed by a decaf `Context` (auto-boot always appends a `Context`)
   * @return {Promise<{config: TConfig, client: TClient}>} The resolved config and constructed client
   */
  abstract override initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: TConfig; client: TClient }>;

  /**
   * @description Writes a blob under the given key
   * @summary Serializes the value, optionally enforces `ifNotExists` and
   * `expectedSha256`, and stores it with the provider backend.
   * @param {BlobKey} key - Logical blob key (prefixed by the configured `prefix`)
   * @param {BlobValue} value - Payload as `Uint8Array`, `Buffer`, or async stream
   * @param {BlobPutOptions} [options] - Put options (conditional write, content type, metadata, checksum)
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<BlobPutResult>} The stored blob descriptor (key, URI, metadata)
   */
  abstract put(
    key: BlobKey,
    value: BlobValue,
    options?: BlobPutOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult>;

  /**
   * @description Reads a blob by key
   * @summary Returns the payload as an async iterable along with its metadata.
   * @param {BlobKey} key - Logical blob key
   * @param {BlobGetOptions} [options] - Get options (byte range, version)
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<BlobGetResult>} The blob payload stream and metadata
   * @throws {NotFoundError} If the blob does not exist
   */
  abstract get(
    key: BlobKey,
    options?: BlobGetOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobGetResult>;

  /**
   * @description Checks whether a blob exists
   * @summary Must not throw when the blob is missing; resolves `false` instead.
   * @param {BlobKey} key - Logical blob key
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<boolean>} `true` when the blob exists, `false` otherwise
   */
  abstract has(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean>;

  /**
   * @description Reads blob metadata without downloading the payload
   * @summary Returns content type, length, etag, and provider-specific metadata.
   * @param {BlobKey} key - Logical blob key
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<BlobMetadata>} The blob metadata
   * @throws {NotFoundError} If the blob does not exist
   */
  abstract stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata>;

  /**
   * @description Deletes a blob
   * @summary Should be idempotent; deleting a missing blob must not throw.
   * @param {BlobKey} key - Logical blob key
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<void>} Resolves when the blob is deleted
   */
  abstract delete(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<void>;

  /**
   * @description Copies a blob to another key
   * @summary Performs a server-side copy where the backend supports it.
   * @param {BlobKey} fromKey - Source logical blob key
   * @param {BlobKey} toKey - Target logical blob key
   * @param {BlobPutOptions} [options] - Copy options (content type, metadata)
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<BlobPutResult>} The copied blob descriptor
   * @throws {NotFoundError} If the source blob does not exist
   */
  abstract copy(
    fromKey: BlobKey,
    toKey: BlobKey,
    options?: BlobPutOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult>;

  /**
   * @description Lists blobs under an optional prefix
   * @summary Returns a page of keys with metadata and an optional pagination cursor.
   * @param {BlobListOptions} [options] - List options (prefix, limit, cursor)
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<BlobListResult>} The page of items and the next cursor, if any
   */
  abstract list(
    options?: BlobListOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobListResult>;

  /**
   * @description Builds a URL for direct access to a blob
   * @summary Backends with signed-URL support return a presigned URL; others
   * return the canonical provider URI.
   * @param {BlobKey} key - Logical blob key
   * @param {BlobUrlOptions} [options] - URL options (operation, expiry, content type)
   * @param {...MaybeContextualArg<any>} args - Optional decaf `Context` for logging
   * @return {Promise<BlobUrlResult>} The URL, HTTP method, and expiry
   */
  abstract url(
    key: BlobKey,
    options?: BlobUrlOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobUrlResult>;

  /**
   * @description Composes the physical storage key for a logical blob key
   * @summary Prepends the configured `prefix` to the given key.
   * @param {BlobKey} key - Logical blob key
   * @return {string} The physical key including the configured prefix
   */
  protected physicalKey(key: BlobKey): string {
    return physicalKey(key, this.config.prefix);
  }

  /**
   * @description Normalizes a logical blob key
   * @summary Delegates to `cleanKey` (trims slashes and collapses separators).
   * @param {BlobKey} key - Logical blob key
   * @return {string} The normalized key
   */
  protected cleanKey(key: BlobKey): string {
    return cleanKey(key);
  }

  /**
   * @description Resolves the provider config from the initialize arguments or the provider's environment slice
   * @summary `Service.boot` passes a decaf `Context` (not a blob config) to
   * every registered `ClientBasedService`, so an object-shaped argument must
   * not blindly be treated as config. A real blob config always carries a
   * non-empty string `provider` (see {@link BlobStoreService.isConfigLike}).
   * Resolution order: explicit config argument, then the provider's
   * `configFromEnvironment()` slice. When neither resolves, `undefined` is
   * returned only for a context-bearing auto-boot so an unconfigured provider
   * (e.g. an optional `blob-minio`/`blob-r2` registered alongside `blob-s3`)
   * does not block the whole service graph from booting; an explicit
   * `initialize()` with neither config nor environment still throws.
   *
   * @template TExpected - The provider-specific config type expected by the caller
   * @param {...MaybeContextualArg<any>} args - Initialize arguments: an optional blob config and/or a decaf `Context`
   * @return {TExpected | undefined} The resolved config, or `undefined` when a context-bearing auto-boot has no resolvable config
   * @throws {ValidationError} When called explicitly (no `Context` in `args`) and no config argument or environment config is available
   *
   * @mermaid
   * sequenceDiagram
   *   participant Caller as Service.boot / initialize()
   *   participant Service as BlobStoreService
   *   participant Env as configFromEnvironment()
   *
   *   Caller->>Service: ...args (config?, Context?)
   *   activate Service
   *   Service->>Service: isConfigLike(args[0])
   *   alt config-like argument present
   *     Service-->>Caller: config
   *   else no config-like argument
   *     Service->>Env: read provider env slice
   *     activate Env
   *     Env-->>Service: env config | undefined
   *     deactivate Env
   *     alt env config resolved
   *       Service-->>Caller: config
   *     else no env config
   *       Service->>Service: hasContext(args)
   *       alt Context present (auto-boot)
   *         Service-->>Caller: undefined (skip initialization)
   *       else explicit initialize()
   *         Service--xCaller: ValidationError
   *       end
   *     end
   *   end
   *   deactivate Service
   */
  protected getConfigFromArgs<TExpected extends TConfig>(
    ...args: MaybeContextualArg<any>
  ): TExpected | undefined {
    const config = args[0] as TExpected | undefined;
    if (config && this.isConfigLike(config)) {
      return config;
    }
    const fromEnvironment = this.configFromEnvironment() as
      | TExpected
      | undefined;
    if (fromEnvironment) return fromEnvironment;
    if (this.hasContext(args)) return undefined;
    throw new ValidationError(
      "Blob store config must be the first initialize argument, or resolvable from environment"
    );
  }

  /**
   * @description Determines whether a value is a blob config object
   * @summary True only for an object that carries a non-empty string
   * `provider` and is not a decaf `Context`. Avoids mistaking a contextual
   * argument (e.g. the `Context` that `Service.boot` passes) for the config.
   * @param {unknown} value - The value to test
   * @return {boolean} `true` when the value is config-like
   */
  protected isConfigLike(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (this.isContextLike(value)) return false;
    const candidate = value as { provider?: unknown };
    return (
      typeof candidate.provider === "string" &&
      candidate.provider.length > 0
    );
  }

  /**
   * @description Detects a decaf `Context` by duck typing
   * @summary True for an object exposing the `Context` method surface (`get`,
   * `accumulate`, `override`, `toOverrides` as functions). Deliberately avoids
   * `instanceof` so linked builds of `@decaf-ts/core` with a duplicate
   * `Context` constructor still resolve.
   * @param {unknown} value - The value to test
   * @return {boolean} `true` when the value duck-types as a decaf `Context`
   */
  protected isContextLike(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const candidate = value as {
      get?: unknown;
      accumulate?: unknown;
      override?: unknown;
      toOverrides?: unknown;
    };
    return (
      typeof candidate.get === "function" &&
      typeof candidate.accumulate === "function" &&
      typeof candidate.override === "function" &&
      typeof candidate.toOverrides === "function"
    );
  }

  /**
   * @description Determines whether the initialize arguments carry a decaf `Context`
   * @summary A `Context` in the arguments marks a background auto-boot of an
   * unconfigured provider (resolved to a skip by
   * {@link BlobStoreService.getConfigFromArgs}), as opposed to an explicit
   * `initialize()` that must fail loudly when no config is available.
   * @param {MaybeContextualArg<any>[]} args - The initialize arguments to inspect
   * @return {boolean} `true` when any argument duck-types as a decaf `Context`
   */
  protected hasContext(args: MaybeContextualArg<any>): boolean {
    return (args || []).some((a) => this.isContextLike(a));
  }

  /**
   * @description Skips initialization for an unconfigured provider during auto-boot
   * @summary Clears `_config`/`_client` and returns a `{ config, client }`
   * result compatible with the `ClientBasedService.initialize` signature so
   * `Service.boot` completes without throwing. Leaves the service
   * deterministic: the `config`/`client` getters still throw if accessed until
   * the service is explicitly initialized with a resolvable config, and the
   * rest of the service graph is not blocked by this provider's absence.
   * Concrete providers invoke this from `initialize()` when
   * `getConfigFromArgs` resolves no config and cast the result to the
   * declared return type.
   * @return {{config: undefined, client: undefined}} An unset config/client pair for the auto-boot path
   */
  protected skipInitialization(): {
    config: undefined;
    client: undefined;
  } {
    this._config = undefined;
    this._client = undefined;
    return { config: undefined, client: undefined };
  }

  /**
   * @description Builds a config from the provider's environment as a fallback.
   * @summary Providers that support environment-sourced configuration should
   * override this to read from their own `blobs.<provider>` environment slice.
   */
  protected abstract configFromEnvironment(): TConfig | undefined;

  /**
   * @description Composes the provider URI for a blob
   * @summary Builds `<scheme>://<sourceId>/<physicalKey>` and appends the
   * extra query fragment (e.g. a version identifier) when provided.
   * @param {BlobKey} key - Logical blob key
   * @param {string} scheme - Provider URI scheme (e.g. `"s3"`, `"memory"`, `"file"`)
   * @param {string} [extra] - Optional query string appended after `?`
   * @return {string} The composed blob URI
   */
  protected uri(key: BlobKey, scheme: string, extra?: string): string {
    const base = `${scheme}://${this.sourceId}/${this.physicalKey(key)}`;
    return extra ? `${base}?${extra}` : base;
  }
}
