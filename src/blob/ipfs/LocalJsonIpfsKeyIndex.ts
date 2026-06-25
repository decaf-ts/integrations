/**
 * @module integrations/blob/ipfs/local-json-index
 * @summary Local JSON-file-backed IPFS key index (stub).
 * @description Documented placeholder; full file implementation is deferred per the spec.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import type { BlobListResult, BlobMetadata } from "../core/BlobTypes";
import type { IpfsKeyIndex } from "./IpfsKeyIndex";

export class LocalJsonIpfsKeyIndex implements IpfsKeyIndex {
  constructor(private readonly path: string) {
    if (!path) {
      throw new InternalError("LocalJsonIpfsKeyIndex requires a path");
    }
  }

  async get(key: string): Promise<string | undefined> {
    throw new InternalError(
      `Implement local JSON IPFS key lookup for ${key} at ${this.path}`
    );
  }

  async set(
    key: string,
    cid: string,
    metadata?: BlobMetadata
  ): Promise<void> {
    throw new InternalError(
      `Implement local JSON IPFS key set for ${key} (cid=${cid}, metadata=${JSON.stringify(metadata)}) at ${this.path}`
    );
  }

  async delete(key: string): Promise<void> {
    throw new InternalError(
      `Implement local JSON IPFS key delete for ${key} at ${this.path}`
    );
  }

  async list(
    prefix?: string,
    limit?: number,
    cursor?: string
  ): Promise<BlobListResult> {
    throw new InternalError(
      `Implement local JSON IPFS key list (prefix=${prefix}, limit=${limit}, cursor=${cursor}) at ${this.path}`
    );
  }

  async stat(key: string): Promise<BlobMetadata> {
    throw new InternalError(
      `Implement local JSON IPFS key stat for ${key} at ${this.path}`
    );
  }
}
