/**
 * @module integrations/blob/s3/minio-environment
 * @summary MinIO blob store environment.
 * @description Extends the common blob environment with the `blobs.minio` shape
 * matching {@link S3BlobStoreServiceConfig}, so {@link MinioBlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";
import type { S3BlobEnvironmentConfig } from "./S3BlobEnvironment";

export interface MinioBlobEnvironmentShape {
  blobs: {
    minio: S3BlobEnvironmentConfig;
  };
}

export const MinioBlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    minio: {
      sourceId: "",
      bucket: "",
      region: "",
      endpoint: "",
      prefix: "",
      forcePathStyle: undefined as unknown as boolean,
      autoCreateBucket: undefined as unknown as boolean,
      maxRetries: undefined as unknown as number,
      credentials: {
        accessKeyId: "",
        secretAccessKey: "",
        sessionToken: "",
      },
    },
  },
} as MinioBlobEnvironmentShape);
