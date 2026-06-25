/**
 * @module integrations/blob/memory/service
 * @summary In-memory blob store service.
 * @description Process-local Map-backed blob store for tests and examples. No SDK dependency.
 */
import { type ContextualArgs, type MaybeContextualArg, UnsupportedError } from "@decaf-ts/core";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from "@decaf-ts/db-decorators";
import { collectToBuffer, computeSha256, toAsyncIterable } from "../core/BlobValue";
import { BlobStoreService } from "../core/BlobStoreService";
import type {
  BlobGetOptions,
  BlobGetResult,
  BlobKey,
  BlobListOptions,
  BlobListResult,
  BlobMetadata,
  BlobPutOptions,
  BlobPutResult,
  BlobStoreServiceConfig,
  BlobUrlOptions,
  BlobUrlResult,
  BlobValue,
} from "../core/BlobTypes";

interface MemoryEntry {
  value: Buffer;
  metadata: BlobMetadata;
}

export class MemoryBlobStoreService extends BlobStoreService<
  Map<string, MemoryEntry>,
  BlobStoreServiceConfig
> {
  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{
    config: BlobStoreServiceConfig;
    client: Map<string, MemoryEntry>;
  }> {
    const config = this.getConfigFromArgs<BlobStoreServiceConfig>(...args);
    this._config = config;
    this._client = new Map<string, MemoryEntry>();
    return { config, client: this._client };
  }

  async put(
    key: BlobKey,
    value: BlobValue,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "put", true)).for(this.put);
    log.verbose(`Putting blob ${key}`);

    const physicalKey = this.physicalKey(key);

    if (options.ifNotExists && this.client.has(physicalKey)) {
      throw new ConflictError(`Blob already exists: ${key}`);
    }

    const buffer = await collectToBuffer(value);
    const sha256 = await computeSha256(buffer);

    if (options.expectedSha256 && options.expectedSha256 !== sha256) {
      throw new ValidationError(`Checksum mismatch for ${key}`);
    }

    const metadata: BlobMetadata = {
      contentType: options.contentType,
      contentLength: buffer.length,
      sha256,
      custom: options.metadata,
    };

    this.client.set(physicalKey, { value: buffer, metadata });

    return {
      key,
      uri: this.uri(key, "memory"),
      provider: this.provider,
      sourceId: this.sourceId,
      metadata,
    };
  }

  async get(
    key: BlobKey,
    options: BlobGetOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobGetResult> {
    const { log } = (await this.logCtx(args, "get", true)).for(this.get);
    log.verbose(`Getting blob ${key}`);

    const physicalKey = this.physicalKey(key);
    const entry = this.client.get(physicalKey);

    if (!entry) {
      throw new NotFoundError(`Blob not found: ${key}`);
    }

    let value: BlobValue = entry.value;
    if (options.range) {
      const start = options.range.start;
      const end = options.range.end ?? entry.value.length;
      value = entry.value.subarray(start, end);
    }

    return {
      key,
      value: toAsyncIterable(value),
      uri: this.uri(key, "memory"),
      provider: this.provider,
      sourceId: this.sourceId,
      metadata: entry.metadata,
    };
  }

  async has(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "has", true)).for(this.has);
    log.verbose(`Checking blob ${key}`);
    return this.client.has(this.physicalKey(key));
  }

  async stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata> {
    const { log } = (await this.logCtx(args, "stat", true)).for(this.stat);
    log.verbose(`Statting blob ${key}`);
    const entry = this.client.get(this.physicalKey(key));
    if (!entry) {
      throw new NotFoundError(`Blob not found: ${key}`);
    }
    return entry.metadata;
  }

  async delete(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    log.verbose(`Deleting blob ${key}`);
    this.client.delete(this.physicalKey(key));
  }

  async copy(
    fromKey: BlobKey,
    toKey: BlobKey,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "copy", true)).for(this.copy);
    log.verbose(`Copying blob ${fromKey} to ${toKey}`);
    const source = this.client.get(this.physicalKey(fromKey));
    if (!source) {
      throw new NotFoundError(`Blob not found: ${fromKey}`);
    }
    return this.put(toKey, source.value, {
      ...options,
      contentType: options.contentType ?? source.metadata.contentType,
    });
  }

  async list(
    options: BlobListOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobListResult> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing blobs");

    const prefix = options.prefix ? this.physicalKey(options.prefix) : "";
    const allKeys = Array.from(this.client.keys())
      .filter((k) => (prefix ? k.startsWith(prefix) : true))
      .sort();

    const limit = options.limit ?? 1000;
    const startIndex = options.cursor ? Number(options.cursor) : 0;
    const slice = allKeys.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < allKeys.length
        ? String(startIndex + limit)
        : undefined;

    return {
      items: slice.map((k) => ({
        key: k,
        metadata: this.client.get(k)?.metadata,
      })),
      cursor: nextCursor,
    };
  }

  async url(
    key: BlobKey,
    options: BlobUrlOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobUrlResult> {
    const { log } = (await this.logCtx(args, "url", true)).for(this.url);
    log.verbose(`Building url for blob ${key}`);
    if (options.operation && options.operation !== "get") {
      throw new UnsupportedError("Memory blob store does not support PUT urls");
    }
    return {
      url: this.uri(key, "memory"),
      method: "GET",
      expiresAt: new Date(
        Date.now() + (options.expiresInSeconds ?? 300) * 1000
      ),
    };
  }

  protected parseError(error: unknown): Error {
    if (
      error instanceof NotFoundError ||
      error instanceof ConflictError ||
      error instanceof ValidationError ||
      error instanceof InternalError
    ) {
      return error as Error;
    }
    return new InternalError(
      `Memory blob error: ${(error as Error).message}`
    );
  }
}
