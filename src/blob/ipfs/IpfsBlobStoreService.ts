/**
 * @module integrations/blob/ipfs/service
 * @summary IPFS blob store service.
 * @description Blob store backed by an IPFS (Kubo) node. Because the blob API is key/value CRUD-like
 * and IPFS is content-addressed, an IpfsKeyIndex maps logical keys to CIDs.
 */
import { create as kuboCreate, type KuboRPCClient } from "kubo-rpc-client";
import {
  type ContextualArgs,
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
  IpfsBlobStoreServiceConfig,
} from "../core/BlobTypes";
import { createIpfsKeyIndex, type IpfsKeyIndex } from "./IpfsKeyIndex";

export class IpfsBlobStoreService extends BlobStoreService<
  KuboRPCClient,
  IpfsBlobStoreServiceConfig
> {
  private index!: IpfsKeyIndex;

  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{
    config: IpfsBlobStoreServiceConfig;
    client: KuboRPCClient;
  }> {
    const { log } = (
      await this.logCtx(args, "initialize", true)
    ).for(this.initialize);
    const config =
      this.getConfigFromArgs<IpfsBlobStoreServiceConfig>(...args);

    const apiUrl = config.apiUrl || "http://localhost:5001";
    const client = kuboCreate({ url: apiUrl });
    this.index = createIpfsKeyIndex(config.keyIndex);
    this._config = config;
    this._client = client;

    log.verbose(`Initialized IPFS blob store ${config.sourceId}`);
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
    const physicalKey = this.physicalKey(key);

    if (this.config.encryptedOnly && options.metadata?.encrypted !== "true") {
      throw new ValidationError(
        "IPFS blob store requires encrypted payloads"
      );
    }

    if (options.ifNotExists && (await this.has(key))) {
      throw new ConflictError(`Blob already exists: ${key}`);
    }

    const buffer = await collectToBuffer(value);

    if (options.expectedSha256) {
      const sha256 = await computeSha256(buffer);
      if (options.expectedSha256 !== sha256) {
        throw new ValidationError(`Checksum mismatch for ${key}`);
      }
    }

    try {
      const addResult = await this.client.add(buffer as any);
      const cid = addResult.cid.toString();
      const size = addResult.size;

      if (this.config.pinByDefault !== false) {
        try {
          await this.client.pin.add(cid);
        } catch (e) {
          log.silly(`Pin failed for ${cid}: ${(e as Error).message}`);
        }
      }

      const metadata: BlobMetadata = {
        contentLength: size,
        sha256: undefined,
        cid,
        contentType: options.contentType,
        custom: options.metadata,
      };

      await this.index.set(physicalKey, cid, metadata);

      return {
        key,
        uri: `ipfs://${cid}`,
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
    const physicalKey = this.physicalKey(key);
    const cid = await this.index.get(physicalKey);
    if (!cid) {
      throw new NotFoundError(`Blob not found: ${key}`);
    }

    const metadata = await this.index.stat(physicalKey);
    const catIterable = this.client.cat(cid);
    void options;

    return {
      key,
      value: toAsyncIterable(catIterable as any),
      uri: `ipfs://${cid}`,
      provider: this.provider,
      sourceId: this.sourceId,
      metadata,
    };
  }

  async has(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "has", true)).for(this.has);
    log.verbose(`Checking blob ${key}`);
    const physicalKey = this.physicalKey(key);
    return Boolean(await this.index.get(physicalKey));
  }

  async stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata> {
    const { log } = (await this.logCtx(args, "stat", true)).for(this.stat);
    log.verbose(`Statting blob ${key}`);
    const physicalKey = this.physicalKey(key);
    try {
      return await this.index.stat(physicalKey);
    } catch {
      throw new NotFoundError(`Blob not found: ${key}`);
    }
  }

  async delete(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    log.verbose(`Deleting blob ${key}`);
    const physicalKey = this.physicalKey(key);
    const cid = await this.index.get(physicalKey);
    if (cid) {
      try {
        await this.client.pin.rm(cid);
      } catch (e) {
        log.silly(`Unpin failed for ${cid}: ${(e as Error).message}`);
      }
    }
    await this.index.delete(physicalKey);
  }

  async copy(
    fromKey: BlobKey,
    toKey: BlobKey,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "copy", true)).for(this.copy);
    log.verbose(`Copying blob ${fromKey} to ${toKey}`);
    const source = await this.get(fromKey);
    return this.put(toKey, source.value, options);
  }

  async list(
    options: BlobListOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobListResult> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing blobs");
    const prefix = options.prefix ? this.physicalKey(options.prefix) : undefined;
    return this.index.list(prefix, options.limit, options.cursor);
  }

  async url(
    key: BlobKey,
    options: BlobUrlOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobUrlResult> {
    const { log } = (await this.logCtx(args, "url", true)).for(this.url);
    log.verbose(`Building url for blob ${key}`);
    if (options.operation && options.operation !== "get") {
      throw new UnsupportedError(
        "IPFS does not support PUT urls through this API"
      );
    }
    const physicalKey = this.physicalKey(key);
    const cid = await this.index.get(physicalKey);
    if (!cid) {
      throw new NotFoundError(`Blob not found: ${key}`);
    }
    if (!this.config.gatewayUrl) {
      throw new UnsupportedError("No IPFS gateway configured");
    }
    return {
      url: `${this.config.gatewayUrl.replace(/\/$/, "")}/ipfs/${cid}`,
      method: "GET",
      expiresAt: new Date(
        Date.now() + (options.expiresInSeconds ?? 300) * 1000
      ),
    };
  }

  protected parseError(error: unknown): Error {
    const err = error as Error;
    if (
      err instanceof NotFoundError ||
      err instanceof ConflictError ||
      err instanceof ValidationError ||
      err instanceof InternalError
    ) {
      return err;
    }
    const message = err.message || "Unknown error";
    const lower = message.toLowerCase();

    if (lower.includes("not found") || lower.includes("does not exist")) {
      return new NotFoundError(err);
    }
    if (lower.includes("already exists") || lower.includes("conflict")) {
      return new ConflictError(err);
    }
    return new InternalError(`IPFS error: ${message}`);
  }
}
