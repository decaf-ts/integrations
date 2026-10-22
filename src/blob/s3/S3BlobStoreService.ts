/**
 * @module integrations/blob/s3/service
 * @summary AWS S3 blob store service.
 * @description Thin undecorated AWS S3 provider service on top of {@link S3CompatibleBlobStoreService}.
 */
import { Context, ContextualArgs } from "@decaf-ts/core";
import { S3CompatibleBlobStoreService } from "./S3CompatibleBlobStoreService";
import { S3BlobEnvironment } from "./S3BlobEnvironment";
import {
  envBoolean,
  envNumber,
  envString,
} from "../../shared/environmentValue";
import type { S3BlobStoreServiceConfig } from "../core/BlobTypes";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * @description AWS S3 blob store service
 * @summary Undecorated provider service storing blobs in an AWS S3 bucket
 * through {@link S3CompatibleBlobStoreService}. Falls back to the `blobs.s3`
 * environment slice when `initialize()` is called without an explicit config.
 * @class S3BlobStoreService
 * @memberOf module:integrations/blob/s3/service
 */
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
            secretAccessKey: envString(
              env.credentials?.secretAccessKey
            ) as string,
            sessionToken: envString(env.credentials?.sessionToken),
          }
        : undefined,
    };
  }

  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: S3BlobStoreServiceConfig; client: S3Client }> {
    if (!args[0] || args[0] instanceof Context) {
      const cfg = this.configFromEnvironment();
      return cfg
        ? super.initialize(cfg, ...args)
        : super.initialize(...args);
    }
    return super.initialize(...args);
  }
}
