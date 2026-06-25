/**
 * @module integrations/blob/ipfs/key-index
 * @summary IPFS key index abstraction.
 * @description Maps logical blob keys to content-addressed CIDs since the blob API is key/value CRUD-like
 * while IPFS is content-addressed.
 */
import { UnsupportedError } from "@decaf-ts/core";
import type {
  BlobListResult,
  BlobMetadata,
  IpfsKeyIndexConfig,
} from "../core/BlobTypes";
import { MemoryIpfsKeyIndex } from "./MemoryIpfsKeyIndex";
import { PostgresIpfsKeyIndex } from "./PostgresIpfsKeyIndex";
import { LocalJsonIpfsKeyIndex } from "./LocalJsonIpfsKeyIndex";

export interface IpfsKeyIndex {
  get(key: string): Promise<string | undefined>;
  set(key: string, cid: string, metadata?: BlobMetadata): Promise<void>;
  delete(key: string): Promise<void>;
  list(
    prefix?: string,
    limit?: number,
    cursor?: string
  ): Promise<BlobListResult>;
  stat(key: string): Promise<BlobMetadata>;
}

export function createIpfsKeyIndex(
  config: IpfsKeyIndexConfig
): IpfsKeyIndex {
  switch (config.provider) {
    case "memory":
      return new MemoryIpfsKeyIndex();
    case "postgres":
      return new PostgresIpfsKeyIndex(config.connectionRef!);
    case "local-json":
      return new LocalJsonIpfsKeyIndex(config.path!);
    default:
      throw new UnsupportedError(
        `Unsupported IPFS key index provider: ${(config as any).provider}`
      );
  }
}
