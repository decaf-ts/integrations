/**
 * @module integrations/blob/s3/minio
 * @summary MinIO blob store service.
 * @description S3-compatible blob store for MinIO.
 */
import { service } from "@decaf-ts/core";
import { S3CompatibleBlobStoreService } from "./S3CompatibleBlobStoreService";
import { MinioBlobEnvironment } from "./MinioBlobEnvironment";
import { envBoolean, envNumber, envString } from "../../shared/environmentValue";
import type { S3BlobStoreServiceConfig } from "../core/BlobTypes";

@service("blob-minio")
export class MinioBlobStoreService extends S3CompatibleBlobStoreService {
  protected override configFromEnvironment():
    | S3BlobStoreServiceConfig
    | undefined {
    const env = MinioBlobEnvironment.blobs.minio;
    const bucket = envString(env?.bucket);
    if (!bucket) return undefined;
    const accessKeyId = envString(env.credentials?.accessKeyId);
    return {
      provider: "minio",
      sourceId: envString(env.sourceId) as string,
      bucket,
      region: envString(env.region),
      endpoint: envString(env.endpoint),
      prefix: envString(env.prefix),
      forcePathStyle: envBoolean(env.forcePathStyle),
      autoCreateBucket: envBoolean(env.autoCreateBucket),
      maxRetries: envNumber(env.maxRetries),
      credentials: accessKeyId
        ? {
            accessKeyId,
            secretAccessKey: envString(env.credentials?.secretAccessKey) as string,
            sessionToken: envString(env.credentials?.sessionToken),
          }
        : undefined,
    };
  }
}
