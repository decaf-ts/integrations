/**
 * @module integrations/blob/gcp/environment
 * @summary Google Cloud Storage blob store environment.
 * @description Extends the common blob environment with the `blobs.gcs` shape
 * matching {@link GcsBlobStoreServiceConfig}, so {@link GcsBlobStoreService}
 * can fall back to it when no config is passed to `initialize`. The `credentials`
 * field is intentionally left out: it is an opaque JSON object, not a flat set of
 * env-friendly values, so it is expected to come through the constructor config.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";

export interface GcsBlobEnvironmentConfig {
  sourceId: string;
  bucket: string;
  projectId?: string;
  apiEndpoint?: string;
  prefix?: string;
}

export interface GcsBlobEnvironmentShape {
  blobs: {
    gcs: GcsBlobEnvironmentConfig;
  };
}

export const GcsBlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    gcs: {
      sourceId: "",
      bucket: "",
      projectId: "",
      apiEndpoint: "",
      prefix: "",
    },
  },
} as GcsBlobEnvironmentShape);
