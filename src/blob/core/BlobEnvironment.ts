/**
 * @module integrations/blob/core/environment
 * @summary Common blob store environment.
 * @description Base environment shared by every blob store provider. Provider-specific
 * services extend this environment with their own predefined `blobs.<provider>` shape
 * so {@link BlobStoreService.initialize} can fall back to environment-sourced config
 * when no config is passed as the first initialize argument.
 */
import { LoggedEnvironment } from "@decaf-ts/logging";
import type { BlobProvider } from "./BlobTypes";

export interface BlobCommonEnvironmentShape {
  blobs: {
    provider: BlobProvider;
  };
}

export const BlobEnvironment = LoggedEnvironment.accumulate({
  blobs: {
    provider: "" as BlobProvider,
  },
} as BlobCommonEnvironmentShape);
