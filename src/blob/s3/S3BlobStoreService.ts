/**
 * @module integrations/blob/s3/service
 * @summary AWS S3 blob store service.
 * @description Thin `@service`-decorated provider on top of {@link S3CompatibleBlobStoreService}.
 */
import { service } from "@decaf-ts/core";
import { S3CompatibleBlobStoreService } from "./S3CompatibleBlobStoreService";
import { S3BlobEnvironment } from "./S3BlobEnvironment";
import { envBoolean, envNumber, envString } from "../../shared/environmentValue";
import type { S3BlobStoreServiceConfig } from "../core/BlobTypes";

@service("blob-s3")
export class S3BlobStoreService extends S3CompatibleBlobStoreService {
  protected override configFromEnvironment():
    | S3BlobStoreServiceConfig
    | undefined {
    const env = S3BlobEnvironment.blobs.s3;
    const bucket = envString(env?.bucket);
    if (!bucket) return undefined;
    const accessKeyId = envString(env.credentials?.accessKeyId);
    return {
      provider: "s3",
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
