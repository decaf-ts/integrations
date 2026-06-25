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

  protected getConfigFromArgs<TExpected extends TConfig>(
    ...args: MaybeContextualArg<any>
  ): TExpected {
    const config = args[0] as TExpected | undefined;
    if (!config || typeof config !== "object") {
      throw new ValidationError(
        "Blob store config must be the first initialize argument"
      );
    }
    return config;
  }

  protected uri(key: BlobKey, scheme: string, extra?: string): string {
    const base = `${scheme}://${this.sourceId}/${this.physicalKey(key)}`;
    return extra ? `${base}?${extra}` : base;
  }
}
