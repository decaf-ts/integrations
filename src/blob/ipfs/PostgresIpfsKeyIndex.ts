/**
 * @module integrations/blob/ipfs/postgres-index
 * @summary Postgres-backed IPFS key index (stub).
 * @description Documented placeholder; full SQL implementation is deferred per the spec.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import type { BlobListResult, BlobMetadata } from "../core/BlobTypes";
import type { IpfsKeyIndex } from "./IpfsKeyIndex";

export class PostgresIpfsKeyIndex implements IpfsKeyIndex {
  constructor(private readonly connectionRef: string) {
    if (!connectionRef) {
      throw new InternalError(
        "PostgresIpfsKeyIndex requires a connectionRef"
      );
    }
  }

  async get(key: string): Promise<string | undefined> {
    throw new InternalError(`Implement Postgres IPFS key lookup for ${key}`);
  }

  async set(
    key: string,
    cid: string,
    metadata?: BlobMetadata
  ): Promise<void> {
    throw new InternalError(
      `Implement Postgres IPFS key set for ${key} (cid=${cid}, metadata=${JSON.stringify(metadata)})`
    );
  }

  async delete(key: string): Promise<void> {
    throw new InternalError(`Implement Postgres IPFS key delete for ${key}`);
  }

  async list(
    prefix?: string,
    limit?: number,
    cursor?: string
  ): Promise<BlobListResult> {
    throw new InternalError(
      `Implement Postgres IPFS key list (prefix=${prefix}, limit=${limit}, cursor=${cursor})`
    );
  }

  async stat(key: string): Promise<BlobMetadata> {
    throw new InternalError(`Implement Postgres IPFS key stat for ${key}`);
  }
}
