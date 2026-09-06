/**
 * @module integrations/blob/s3/r2-environment
 * @summary Cloudflare R2 blob store environment.
 * @description Extends the common blob environment with the `blobs.r2` shape
 * matching {@link S3BlobStoreServiceConfig}, so {@link R2BlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";
import type { S3BlobEnvironmentConfig } from "./S3BlobEnvironment";

export interface R2BlobEnvironmentShape {
  blobs: {
    r2: S3BlobEnvironmentConfig;
  };
}

export const R2BlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    r2: {
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
} as R2BlobEnvironmentShape);
