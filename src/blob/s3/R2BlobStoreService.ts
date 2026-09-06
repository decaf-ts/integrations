/**
 * @module integrations/blob/s3/r2
 * @summary Cloudflare R2 blob store service.
 * @description S3-compatible blob store for Cloudflare R2.
 */
import { service } from "@decaf-ts/core";
import { S3CompatibleBlobStoreService } from "./S3CompatibleBlobStoreService";
import { R2BlobEnvironment } from "./R2BlobEnvironment";
import { envBoolean, envNumber, envString } from "../../shared/environmentValue";
import type { S3BlobStoreServiceConfig } from "../core/BlobTypes";

@service("blob-r2")
export class R2BlobStoreService extends S3CompatibleBlobStoreService {
  protected override configFromEnvironment():
    | S3BlobStoreServiceConfig
    | undefined {
    const env = R2BlobEnvironment.blobs.r2;
    const bucket = envString(env?.bucket);
    if (!bucket) return undefined;
    const accessKeyId = envString(env.credentials?.accessKeyId);
    return {
      provider: "r2",
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
