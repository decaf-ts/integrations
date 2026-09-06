/**
 * @module integrations/blob/memory/environment
 * @summary In-memory blob store environment.
 * @description Extends the common blob environment with the `blobs.memory` shape
 * matching {@link BlobStoreServiceConfig}, so {@link MemoryBlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";

export interface MemoryBlobEnvironmentConfig {
  sourceId: string;
  prefix?: string;
}

export interface MemoryBlobEnvironmentShape {
  blobs: {
    memory: MemoryBlobEnvironmentConfig;
  };
}

export const MemoryBlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    memory: {
      sourceId: "",
      prefix: "",
    },
  },
} as MemoryBlobEnvironmentShape);
