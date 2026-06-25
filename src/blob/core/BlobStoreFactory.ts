/**
 * @module integrations/blob/core/factory
 * @summary Blob store factory.
 * @description Creates uninitialized blob store services selected by provider.
 */
import { ValidationError } from "@decaf-ts/db-decorators";
import type { BlobStoreServiceConfig } from "./BlobTypes";
import type { BlobStoreService } from "./BlobStoreService";
import { S3BlobStoreService } from "../s3/S3BlobStoreService";
import { MinioBlobStoreService } from "../s3/MinioBlobStoreService";
import { R2BlobStoreService } from "../s3/R2BlobStoreService";
import { AzureBlobStoreService } from "../azure/AzureBlobStoreService";
import { GcsBlobStoreService } from "../gcp/GcsBlobStoreService";
import { LocalBlobStoreService } from "../local/LocalBlobStoreService";
import { IpfsBlobStoreService } from "../ipfs/IpfsBlobStoreService";
import { MemoryBlobStoreService } from "../memory/MemoryBlobStoreService";

export class BlobStoreFactory {
  create<T extends BlobStoreServiceConfig>(
    config: T
  ): BlobStoreService {
    let service: BlobStoreService;
    switch (config.provider) {
      case "s3":
        service = new S3BlobStoreService() as unknown as BlobStoreService;
        break;
      case "minio":
        service = new MinioBlobStoreService() as unknown as BlobStoreService;
        break;
      case "r2":
        service = new R2BlobStoreService() as unknown as BlobStoreService;
        break;
      case "azure-blob":
        service = new AzureBlobStoreService() as unknown as BlobStoreService;
        break;
      case "gcs":
        service = new GcsBlobStoreService() as unknown as BlobStoreService;
        break;
      case "local":
        service = new LocalBlobStoreService() as unknown as BlobStoreService;
        break;
      case "ipfs":
        service = new IpfsBlobStoreService() as unknown as BlobStoreService;
        break;
      case "memory":
        service = new MemoryBlobStoreService() as unknown as BlobStoreService;
        break;
      default:
        return assertNever(config);
    }
    return service;
  }
}

function assertNever(value: BlobStoreServiceConfig): never {
  throw new ValidationError(
    `Unsupported blob provider: ${JSON.stringify(value)}`
  );
}
