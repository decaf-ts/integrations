/**
 * @module integrations/blob/azure/environment
 * @summary Azure Blob store environment.
 * @description Extends the common blob environment with the `blobs.azure` shape
 * matching {@link AzureBlobStoreServiceConfig}, so {@link AzureBlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";

/**
 * @description Mirrors {@link AzureBlobStoreServiceConfig} (minus `provider`, which
 * is fixed for this provider). Declared as a plain shape rather than derived via
 * `Omit` from the config type, since that type carries a `[key: string]: unknown`
 * index signature that would collapse these fields to `unknown` when threaded
 * through the Environment's mapped types.
 */
export interface AzureBlobEnvironmentConfig {
  sourceId: string;
  container: string;
  accountName?: string;
  connectionString?: string;
  endpoint?: string;
  prefix?: string;
}

export interface AzureBlobEnvironmentShape {
  blobs: {
    azure: AzureBlobEnvironmentConfig;
  };
}

export const AzureBlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    azure: {
      sourceId: "",
      container: "",
      accountName: "",
      connectionString: "",
      endpoint: "",
      prefix: "",
    },
  },
} as AzureBlobEnvironmentShape);
