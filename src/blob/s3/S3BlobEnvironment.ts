/**
 * @module integrations/blob/s3/environment
 * @summary AWS S3 blob store environment.
 * @description Extends the common blob environment with the `blobs.s3` shape
 * matching {@link S3BlobStoreServiceConfig}, so {@link S3BlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";

export interface S3BlobEnvironmentCredentials {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface S3BlobEnvironmentConfig {
  sourceId: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  prefix?: string;
  forcePathStyle?: boolean;
  autoCreateBucket?: boolean;
  maxRetries?: number;
  credentials?: S3BlobEnvironmentCredentials;
}

export interface S3BlobEnvironmentShape {
  blobs: {
    s3: S3BlobEnvironmentConfig;
  };
}

export const S3BlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    s3: {
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
} as S3BlobEnvironmentShape);
