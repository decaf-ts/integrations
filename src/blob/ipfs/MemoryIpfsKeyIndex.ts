/**
 * @module integrations/blob/ipfs/memory-index
 * @summary In-memory IPFS key index.
 * @description Process-local Map-backed key index for tests and examples.
 */
import type { BlobListResult, BlobMetadata } from "../core/BlobTypes";
import type { IpfsKeyIndex } from "./IpfsKeyIndex";

interface IndexEntry {
  cid: string;
  metadata: BlobMetadata;
}

export class MemoryIpfsKeyIndex implements IpfsKeyIndex {
  private readonly values = new Map<string, IndexEntry>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key)?.cid;
  }

  async set(
    key: string,
    cid: string,
    metadata?: BlobMetadata
  ): Promise<void> {
    this.values.set(key, {
      cid,
      metadata: { ...metadata, cid },
    });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(
    prefix = "",
    limit = 1000,
    cursor?: string
  ): Promise<BlobListResult> {
    const all = Array.from(this.values.keys())
      .filter((k) => (prefix ? k.startsWith(prefix) : true))
      .sort();
    const startIndex = cursor ? Number(cursor) : 0;
    const slice = all.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < all.length ? String(startIndex + limit) : undefined;
    return {
      items: slice.map((key) => ({
        key,
        metadata: this.values.get(key)?.metadata,
      })),
      cursor: nextCursor,
    };
  }

  async stat(key: string): Promise<BlobMetadata> {
    const entry = this.values.get(key);
    if (!entry) {
      throw new Error(`Blob not found: ${key}`);
    }
    return entry.metadata;
  }
}
