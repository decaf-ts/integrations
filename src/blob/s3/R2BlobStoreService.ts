/**
 * @module integrations/blob/s3/r2
 * @summary Cloudflare R2 blob store service.
 * @description S3-compatible blob store for Cloudflare R2. Extends S3BlobStoreService.
 */
import { S3BlobStoreService } from "./S3BlobStoreService";

export class R2BlobStoreService extends S3BlobStoreService {}
