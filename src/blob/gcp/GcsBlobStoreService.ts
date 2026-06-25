/**
 * @module integrations/blob/gcp/service
 * @summary Google Cloud Storage blob store service.
 * @description Blob store backed by Google Cloud Storage via @google-cloud/storage.
 */
import { Storage, type Bucket } from "@google-cloud/storage";
import {
  AuthorizationError,
  type ContextualArgs,
  ConnectionError,
  ForbiddenError,
  type MaybeContextualArg,
  UnsupportedError,
} from "@decaf-ts/core";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from "@decaf-ts/db-decorators";
import { BlobStoreService } from "../core/BlobStoreService";
import { collectToBuffer, computeSha256, toAsyncIterable } from "../core/BlobValue";
import type {
  BlobGetOptions,
  BlobGetResult,
  BlobKey,
  BlobListOptions,
  BlobListResult,
  BlobMetadata,
  BlobPutOptions,
  BlobPutResult,
  BlobUrlOptions,
  BlobUrlResult,
  BlobValue,
  GcsBlobStoreServiceConfig,
} from "../core/BlobTypes";

export class GcsBlobStoreService extends BlobStoreService<
  Bucket,
  GcsBlobStoreServiceConfig
> {
  private storage!: Storage;

  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{
    config: GcsBlobStoreServiceConfig;
    client: Bucket;
  }> {
    const { log } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config =
      this.getConfigFromArgs<GcsBlobStoreServiceConfig>(...args);
    if (!config.bucket) {
      throw new InternalError("GcsBlobStoreService requires a bucket");
    }

    const storageOptions: Record<string, unknown> = {};
    if (config.projectId) storageOptions.projectId = config.projectId;
    if (config.credentials) storageOptions.credentials = config.credentials;
    if (config.apiEndpoint) storageOptions.apiEndpoint = config.apiEndpoint;

    this.storage = new Storage(storageOptions);
    const client = this.storage.bucket(config.bucket);
    this._config = config;
    this._client = client;

    log.verbose(`Initialized GCS blob store ${config.sourceId}`);
    return { config, client };
  }

  async put(
    key: BlobKey,
    value: BlobValue,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "put", true)).for(this.put);
    log.verbose(`Putting blob ${key}`);
    const objectName = this.physicalKey(key);

    if (options.ifNotExists) {
      if (await this.has(key)) {
        throw new ConflictError(`Blob already exists: ${key}`);
      }
    }

    const buffer = await collectToBuffer(value);

    if (options.expectedSha256) {
      const sha256 = await computeSha256(buffer);
      if (options.expectedSha256 !== sha256) {
        throw new ValidationError(`Checksum mismatch for ${key}`);
      }
    }

    try {
      const file = this.client.file(objectName);
      const metadata: Record<string, string> = { ...(options.metadata ?? {}) };
      await file.save(buffer, {
        contentType: options.contentType,
        metadata,
      });
      const [info] = await file.getMetadata();
      const resultMetadata: BlobMetadata = {
        contentType: options.contentType,
        contentLength: Number(info.size ?? buffer.length),
        etag: info.etag,
        custom: options.metadata,
      };
      return {
        key,
        uri: this.uri(key, "gcs"),
        provider: this.provider,
        sourceId: this.sourceId,
        metadata: resultMetadata,
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async get(
    key: BlobKey,
    options: BlobGetOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobGetResult> {
    const { log } = (await this.logCtx(args, "get", true)).for(this.get);
    log.verbose(`Getting blob ${key}`);
    const objectName = this.physicalKey(key);
    try {
      const file = this.client.file(objectName);
      const [exists] = await file.exists();
      if (!exists) {
        throw new NotFoundError(`Blob not found: ${key}`);
      }

      const readOptions: Record<string, unknown> = {};
      if (options.range) {
        readOptions.start = options.range.start;
        if (options.range.end !== undefined) readOptions.end = options.range.end;
      }

      const [info] = await file.getMetadata();
      const stream = file.createReadStream(readOptions);
      const metadata: BlobMetadata = {
        contentType: info.contentType,
        contentLength: Number(info.size),
        etag: info.etag,
      };

      return {
        key,
        value: toAsyncIterable(stream as any),
        uri: this.uri(key, "gcs"),
        provider: this.provider,
        sourceId: this.sourceId,
        metadata,
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async has(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "has", true)).for(this.has);
    log.verbose(`Checking blob ${key}`);
    try {
      const [exists] = await this.client.file(this.physicalKey(key)).exists();
      return exists;
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata> {
    const { log } = (await this.logCtx(args, "stat", true)).for(this.stat);
    log.verbose(`Statting blob ${key}`);
    try {
      const [info] = await this.client.file(this.physicalKey(key)).getMetadata();
      return {
        contentType: info.contentType,
        contentLength: Number(info.size),
        etag: info.etag,
        custom: info.metadata as Record<string, string> | undefined,
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async delete(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    log.verbose(`Deleting blob ${key}`);
    try {
      await this.client.file(this.physicalKey(key)).delete({ ignoreNotFound: true });
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async copy(
    fromKey: BlobKey,
    toKey: BlobKey,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "copy", true)).for(this.copy);
    log.verbose(`Copying blob ${fromKey} to ${toKey}`);
    try {
      const sourceFile = this.client.file(this.physicalKey(fromKey));
      const targetFile = this.client.file(this.physicalKey(toKey));
      const [copied] = await sourceFile.copy(targetFile);
      const [info] = await copied.getMetadata();
      const metadata: BlobMetadata = {
        contentType: options.contentType ?? info.contentType,
        contentLength: Number(info.size),
        etag: info.etag,
        custom: options.metadata,
      };
      return {
        key: toKey,
        uri: this.uri(toKey, "gcs"),
        provider: this.provider,
        sourceId: this.sourceId,
        metadata,
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async list(
    options: BlobListOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobListResult> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing blobs");
    const prefix = this.physicalKey(options.prefix ?? "");
    try {
      const items: { key: string; metadata?: BlobMetadata }[] = [];
      const [files] = await this.client.getFiles({
        prefix: prefix || undefined,
        maxResults: options.limit,
        pageToken: options.cursor,
      });
      for (const file of files) {
        const [info] = await file.getMetadata();
        items.push({
          key: file.name,
          metadata: {
            contentLength: Number(info.size),
            etag: info.etag,
            contentType: info.contentType,
          },
        });
      }
      return { items };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async url(
    key: BlobKey,
    options: BlobUrlOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobUrlResult> {
    const { log } = (await this.logCtx(args, "url", true)).for(this.url);
    log.verbose(`Building url for blob ${key}`);
    const objectName = this.physicalKey(key);
    const operation = options.operation ?? "get";
    const expiresIn = options.expiresInSeconds ?? 300;
    try {
      const file = this.client.file(objectName);
      const action = operation === "put" ? "write" : "read";
      const config: Record<string, unknown> = {
        version: "v4",
        action,
        expires: Date.now() + expiresIn * 1000,
      };
      if (options.contentType) config.contentType = options.contentType;
      const [url] = await file.getSignedUrl(config as any);
      return {
        url,
        method: operation === "put" ? "PUT" : "GET",
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        headers: options.contentType
          ? { "Content-Type": options.contentType }
          : undefined,
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  protected parseError(error: unknown): Error {
    const err = error as Error;
    if (
      err instanceof NotFoundError ||
      err instanceof ConflictError ||
      err instanceof AuthorizationError ||
      err instanceof ForbiddenError ||
      err instanceof ValidationError ||
      err instanceof ConnectionError ||
      err instanceof UnsupportedError ||
      err instanceof InternalError
    ) {
      return err;
    }
    const message = err.message || "Unknown error";
    const lower = message.toLowerCase();
    const code = (err as any)?.code || (err as any)?.status;

    if (lower.includes("not found") || code === 404 || code === "ENOENT" || code === 5) {
      return new NotFoundError(err);
    }
    if (lower.includes("already exists") || code === 409 || code === "EEXIST" || code === 6) {
      return new ConflictError(err);
    }
    if (lower.includes("unauthorized") || code === 401 || code === 16) {
      return new AuthorizationError(err);
    }
    if (lower.includes("permission") || code === 403 || code === 7) {
      return new ForbiddenError(err);
    }
    if (lower.includes("rate limit") || code === 429 || code === 8) {
      return new ConflictError(err);
    }
    if (lower.includes("timeout") || lower.includes("unavailable") || lower.includes("connection") || code === 14 || code === 503) {
      return new ConnectionError(err);
    }
    return new InternalError(err);
  }
}
