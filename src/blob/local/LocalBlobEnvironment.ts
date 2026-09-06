/**
 * @module integrations/blob/local/environment
 * @summary Local filesystem blob store environment.
 * @description Extends the common blob environment with the `blobs.local` shape
 * matching {@link LocalBlobStoreServiceConfig}, so {@link LocalBlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";

export interface LocalBlobEnvironmentConfig {
  sourceId: string;
  rootPath: string;
  prefix?: string;
}

export interface LocalBlobEnvironmentShape {
  blobs: {
    local: LocalBlobEnvironmentConfig;
  };
}

export const LocalBlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    local: {
      sourceId: "",
      rootPath: "",
      prefix: "",
    },
  },
} as LocalBlobEnvironmentShape);
