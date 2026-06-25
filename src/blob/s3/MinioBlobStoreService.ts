/**
 * @module integrations/blob/s3/minio
 * @summary MinIO blob store service.
 * @description S3-compatible blob store for MinIO. Extends S3BlobStoreService.
 */
import { S3BlobStoreService } from "./S3BlobStoreService";

export class MinioBlobStoreService extends S3BlobStoreService {}
