/**
 * @module integrations/blob/azure/service
 * @summary Azure Blob storage service.
 * @description Blob store backed by Azure Blob Storage via @azure/storage-blob.
 */
import {
  BlobServiceClient,
  type ContainerClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  type StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
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
  AzureBlobStoreServiceConfig,
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
} from "../core/BlobTypes";

export class AzureBlobStoreService extends BlobStoreService<
  ContainerClient,
  AzureBlobStoreServiceConfig
> {
  private blobServiceClient!: BlobServiceClient;

  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{
    config: AzureBlobStoreServiceConfig;
    client: ContainerClient;
  }> {
    const { log } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config =
      this.getConfigFromArgs<AzureBlobStoreServiceConfig>(...args);
    if (!config.container) {
      throw new InternalError(
        "AzureBlobStoreService requires a container"
      );
    }

    if (config.connectionString) {
      this.blobServiceClient =
        BlobServiceClient.fromConnectionString(config.connectionString);
    } else {
      const endpoint = config.endpoint || `https://${config.accountName}.blob.core.windows.net`;
      this.blobServiceClient = new BlobServiceClient(
        endpoint,
        new DefaultAzureCredential()
      );
    }

    const client = this.blobServiceClient.getContainerClient(config.container);
    this._config = config;
    this._client = client;

    log.verbose(`Initialized Azure Blob store ${config.sourceId}`);
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
    const blobName = this.physicalKey(key);

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
      const blockBlobClient = this.client.getBlockBlobClient(blobName);
      const response = await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: options.contentType
          ? { blobContentType: options.contentType }
          : undefined,
        metadata: options.metadata,
      });
      const metadata: BlobMetadata = {
        contentType: options.contentType,
        contentLength: buffer.length,
        etag: response.etag,
        versionId: response.versionId,
        custom: options.metadata,
      };
      return {
        key,
        uri: this.uri(key, "azure-blob", response.versionId ? `version=${response.versionId}` : undefined),
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
    const blobName = this.physicalKey(key);
    try {
      const blobClient = this.client.getBlobClient(blobName);
      const downloadResponse = await blobClient.download(
        options.range?.start,
        options.range
          ? (options.range.end ?? undefined) !== undefined
            ? (options.range.end ?? undefined)! - (options.range?.start ?? 0) + 1
            : undefined
          : undefined
      );

      const metadata: BlobMetadata = {
        contentType: downloadResponse.contentType,
        contentLength: downloadResponse.contentLength,
        etag: downloadResponse.etag,
      };

      const readable = downloadResponse.readableStreamBody as any;
      return {
        key,
        value: toAsyncIterable(readable),
        uri: this.uri(key, "azure-blob"),
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
      const blobClient = this.client.getBlobClient(this.physicalKey(key));
      return Boolean(await blobClient.exists());
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
      const blobClient = this.client.getBlobClient(this.physicalKey(key));
      const props = await blobClient.getProperties();
      return {
        contentType: props.contentType,
        contentLength: props.contentLength,
        etag: props.etag,
        custom: props.metadata as Record<string, string> | undefined,
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
      const blobClient = this.client.getBlobClient(this.physicalKey(key));
      await blobClient.delete();
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
      const sourceClient = this.client.getBlobClient(this.physicalKey(fromKey));
      const targetClient = this.client.getBlobClient(this.physicalKey(toKey));
      const poller = await targetClient.beginCopyFromURL(sourceClient.url);
      await poller.pollUntilDone();
      const props = await targetClient.getProperties();
      const metadata: BlobMetadata = {
        contentType: options.contentType ?? props.contentType,
        contentLength: props.contentLength,
        etag: props.etag,
        custom: options.metadata,
      };
      return {
        key: toKey,
        uri: this.uri(toKey, "azure-blob"),
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
      const maxPageSize = options.limit ?? undefined;
      for await (const blob of this.client.listBlobsFlat({
        prefix: prefix || undefined,
        includeMetadata: true,
      })) {
        items.push({
          key: blob.name,
          metadata: {
            contentLength: blob.properties.contentLength,
            etag: blob.properties.etag,
            contentType: blob.properties.contentType,
            custom: blob.metadata as Record<string, string> | undefined,
          },
        });
        if (maxPageSize && items.length >= maxPageSize) break;
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
    const blobName = this.physicalKey(key);
    const operation = options.operation ?? "get";
    const expiresIn = options.expiresInSeconds ?? 300;
    try {
      const blobClient = this.client.getBlobClient(blobName);

      const credential = (this.blobServiceClient as any).credential as
        | StorageSharedKeyCredential
        | undefined;

      let url: string;
      if (credential && typeof (credential as any).accountName === "string") {
        const sasToken = generateBlobSASQueryParameters(
          {
            containerName: this.config.container,
            blobName,
            permissions: BlobSASPermissions.from({
              read: operation === "get",
              create: operation === "put",
              write: operation === "put",
            }),
            startsOn: new Date(),
            expiresOn: new Date(Date.now() + expiresIn * 1000),
            contentType: options.contentType,
          },
          credential
        ).toString();
        url = `${blobClient.url}?${sasToken}`;
      } else {
        const token = await blobClient.generateSasUrl({
          permissions: BlobSASPermissions.from({
            read: operation === "get",
            create: operation === "put",
            write: operation === "put",
          }),
          expiresOn: new Date(Date.now() + expiresIn * 1000),
          contentType: options.contentType,
        });
        url = token;
      }

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
    const statusCode = (err as any)?.statusCode || (err as any)?.$metadata?.httpStatusCode;
    const code = (err as any)?.code;

    if (lower.includes("blobnotfound") || statusCode === 404 || lower.includes("not found") || code === "BlobNotFound") {
      return new NotFoundError(err);
    }
    if (statusCode === 409 || lower.includes("conflict") || lower.includes("already exists")) {
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
}
