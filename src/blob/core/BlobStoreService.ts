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

export abstract class BlobStoreService<
  TClient = unknown,
  TConfig extends BlobStoreServiceConfig = BlobStoreServiceConfig,
> extends ClientBasedService<TClient, TConfig> {
  constructor() {
    super();
  }

  get provider(): BlobProvider {
    return this.config.provider;
  }

  get sourceId(): string {
    return this.config.sourceId;
  }

  abstract override initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: TConfig; client: TClient }>;

  abstract put(
    key: BlobKey,
    value: BlobValue,
    options?: BlobPutOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult>;

  abstract get(
    key: BlobKey,
    options?: BlobGetOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobGetResult>;

  abstract has(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean>;

  abstract stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata>;

  abstract delete(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<void>;

  abstract copy(
    fromKey: BlobKey,
    toKey: BlobKey,
    options?: BlobPutOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult>;

  abstract list(
    options?: BlobListOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobListResult>;

  abstract url(
    key: BlobKey,
    options?: BlobUrlOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobUrlResult>;

  protected physicalKey(key: BlobKey): string {
    return physicalKey(key, this.config.prefix);
  }

  protected cleanKey(key: BlobKey): string {
    return cleanKey(key);
  }

  // Resolves the provider config from the initialize arguments or the provider's
  // environment slice. `Service.boot` passes a decaf `Context` (not a blob
  // config) to every registered `ClientBasedService`, so an object-shaped arg
  // must not blindly be treated as config. A real blob config always carries a
  // non-empty string `provider`. When no config can be resolved, `undefined` is
  // returned only for a context-bearing auto-boot, so an unconfigured provider
  // (e.g. an optional `blob-minio`/`blob-r2` registered alongside `blob-s3`)
  // does not block the whole service graph from booting; an explicit
  // `initialize()` with neither config nor environment still throws.
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

  // True only for an object that carries a non-empty string `provider` and is
  // not a decaf `Context`. Avoids mistaking a contextual argument (e.g. the
  // `Context` that `Service.boot` passes) for the config.
  protected isConfigLike(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (this.isContextLike(value)) return false;
    const candidate = value as { provider?: unknown };
    return (
      typeof candidate.provider === "string" &&
      candidate.provider.length > 0
    );
  }

  // Duck-typed decaf `Context` detection. Avoids `instanceof` so linked builds
  // of `@decaf-ts/core` with a duplicate `Context` constructor still resolve.
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

  // `Service.boot` passes a `Context`, which marks a background auto-boot of an
  // unconfigured provider (resolved to a skip), as opposed to an explicit
  // `initialize()` that must fail loudly when no config is available.
  protected hasContext(args: MaybeContextualArg<any>): boolean {
    return (args || []).some((a) => this.isContextLike(a));
  }

  // Used when an auto-boot encounters an unconfigured provider; leaves the
  // service deterministic (the `config`/`client` getters still throw if
  // accessed) without blocking the rest of the service graph.
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

  protected uri(key: BlobKey, scheme: string, extra?: string): string {
    const base = `${scheme}://${this.sourceId}/${this.physicalKey(key)}`;
    return extra ? `${base}?${extra}` : base;
  }
}
