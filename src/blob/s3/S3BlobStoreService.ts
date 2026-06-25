/**
 * @module integrations/blob/s3/service
 * @summary S3-compatible blob store service.
 * @description Blob store backed by AWS S3, MinIO, and Cloudflare R2 via the AWS SDK v3 S3Client.
 */
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  S3BlobStoreServiceConfig,
} from "../core/BlobTypes";

export class S3BlobStoreService extends BlobStoreService<
  S3Client,
  S3BlobStoreServiceConfig
> {
  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{
    config: S3BlobStoreServiceConfig;
    client: S3Client;
  }> {
    const { log } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config =
      this.getConfigFromArgs<S3BlobStoreServiceConfig>(...args);
    if (!config.bucket) {
      throw new InternalError("S3BlobStoreService requires a bucket");
    }

    const clientConfig: S3ClientConfig = {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      maxAttempts: config.maxRetries,
    };
    if (config.credentials) {
      clientConfig.credentials = {
        accessKeyId: config.credentials.accessKeyId,
        secretAccessKey: config.credentials.secretAccessKey,
        sessionToken: config.credentials.sessionToken,
      };
    }

    const client = new S3Client(clientConfig);
    this._config = config;
    this._client = client;

    if (config.autoCreateBucket) {
      await this.ensureBucket(log);
    }

    log.verbose(`Initialized S3 blob store ${config.sourceId}`);
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
    const objectKey = this.physicalKey(key);

    if (options.ifNotExists) {
      if (await this.has(key)) {
        throw new ConflictError(`Blob already exists: ${key}`);
      }
    }

    const body = await collectToBuffer(value);

    if (options.expectedSha256) {
      const sha256 = await computeSha256(body);
      if (options.expectedSha256 !== sha256) {
        throw new ValidationError(`Checksum mismatch for ${key}`);
      }
    }

    try {
      const response = await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          Body: body,
          ContentType: options.contentType,
          Metadata: options.metadata,
        })
      );
      const metadata: BlobMetadata = {
        contentType: options.contentType,
        contentLength: body.length,
        etag: response.ETag?.replace(/"/g, ""),
        versionId: response.VersionId,
        custom: options.metadata,
      };
      return {
        key,
        uri: this.uri(key, "s3", response.VersionId ? `versionId=${response.VersionId}` : undefined),
        provider: this.provider,
        sourceId: this.sourceId,
        metadata,
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
    const objectKey = this.physicalKey(key);

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          Range: options.range
            ? `bytes=${options.range.start}-${options.range.end ?? ""}`
            : undefined,
          VersionId: options.versionId,
        })
      );

      const body = response.Body as any;
      const metadata: BlobMetadata = {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        etag: response.ETag?.replace(/"/g, ""),
        versionId: response.VersionId,
      };

      return {
        key,
        value: toAsyncIterable(body),
        uri: this.uri(key, "s3", response.VersionId ? `versionId=${response.VersionId}` : undefined),
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
      await this.stat(key);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }

  async stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata> {
    const { log } = (await this.logCtx(args, "stat", true)).for(this.stat);
    log.verbose(`Statting blob ${key}`);
    const objectKey = this.physicalKey(key);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        })
      );
      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        etag: response.ETag?.replace(/"/g, ""),
        versionId: response.VersionId,
        custom: response.Metadata,
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
    const objectKey = this.physicalKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        })
      );
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
    const from = this.physicalKey(fromKey);
    const to = this.physicalKey(toKey);
    try {
      const response = await this.client.send(
        new CopyObjectCommand({
          Bucket: this.config.bucket,
          CopySource: `${this.config.bucket}/${from}`,
          Key: to,
          ContentType: options.contentType,
          Metadata: options.metadata,
        })
      );
      const metadata: BlobMetadata = {
        contentType: options.contentType,
        etag: response.CopyObjectResult?.ETag?.replace(/"/g, ""),
        versionId: response.VersionId,
        custom: options.metadata,
      };
      return {
        key: toKey,
        uri: this.uri(toKey, "s3"),
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
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix || undefined,
          MaxKeys: options.limit,
          ContinuationToken: options.cursor,
        })
      );
      const items = (response.Contents ?? []).map((obj) => ({
        key: obj.Key as string,
        metadata: {
          contentLength: obj.Size,
          etag: obj.ETag?.replace(/"/g, ""),
        } as BlobMetadata,
      }));
      return {
        items,
        cursor: response.IsTruncated ? response.NextContinuationToken : undefined,
      };
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
    const objectKey = this.physicalKey(key);
    const operation = options.operation ?? "get";
    const expiresIn = options.expiresInSeconds ?? 300;
    try {
      const command =
        operation === "put"
          ? new PutObjectCommand({
              Bucket: this.config.bucket,
              Key: objectKey,
              ContentType: options.contentType,
              Metadata: options.metadata,
            })
          : new GetObjectCommand({
              Bucket: this.config.bucket,
              Key: objectKey,
            });
      const url = await getSignedUrl(this.client, command, { expiresIn });
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
    const message = err.message || err.name || "Unknown error";
    const lower = message.toLowerCase();
    const name = (err as any).name || "";
    const statusCode = (err as any)?.$metadata?.httpStatusCode;

    if (
      name === "NotFound" ||
      name === "NoSuchKey" ||
      statusCode === 404 ||
      lower.includes("not found") ||
      lower.includes("nosuchkey")
    ) {
      return new NotFoundError(err);
    }

    if (
      name === "BucketAlreadyExists" ||
      name === "BucketAlreadyOwnedByYou" ||
      statusCode === 409 ||
      lower.includes("already exists") ||
      lower.includes("conflict")
    ) {
      return new ConflictError(err);
    }

    if (statusCode === 401 || lower.includes("unauthorized")) {
      return new AuthorizationError(err);
    }

    if (statusCode === 403 || lower.includes("permission") || lower.includes("forbidden")) {
      return new ForbiddenError(err);
    }

    if (statusCode === 429 || lower.includes("rate limit")) {
      return new ConflictError(err);
    }

    if (statusCode === 503 || lower.includes("timeout") || lower.includes("unavailable") || lower.includes("connection")) {
      return new ConnectionError(err);
    }

    return new InternalError(err);
  }

  private async ensureBucket(log: any): Promise<void> {
    try {
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.config.bucket })
      );
      log.verbose(`Created bucket ${this.config.bucket}`);
    } catch (error) {
      const name = (error as any)?.name || "";
      if (
        name === "BucketAlreadyExists" ||
        name === "BucketAlreadyOwnedByYou" ||
        (error as any)?.$metadata?.httpStatusCode === 409
      ) {
        log.verbose(`Bucket ${this.config.bucket} already exists`);
        return;
      }
      throw this.parseError(error as Error);
    }
  }
}
