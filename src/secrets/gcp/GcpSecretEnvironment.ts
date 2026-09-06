/**
 * @module integrations/secrets/gcp/environment
 * @summary Google Secret Manager environment.
 * @description Extends the common secrets environment with the `secrets.gcp` shape
 * matching {@link GcpSecretManagerServiceConfig}, so {@link GcpSecretManagerService}
 * can fall back to it when no config is passed to `initialize`. The `credentials` field
 * is intentionally left out: it is an opaque credential object, not a flat set of
 * env-friendly values, so it is expected to come through the constructor config.
 */
import { SecretEnvironment } from "../core/SecretEnvironment";

export interface GcpSecretEnvironmentConfig {
  projectId: string;
  apiEndpoint?: string;
  port?: number;
  keyId?: string;
}

export interface GcpSecretEnvironmentShape {
  secrets: {
    gcp: GcpSecretEnvironmentConfig;
  };
}

export const GcpSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    gcp: {
      projectId: "",
      apiEndpoint: "",
      port: undefined as unknown as number,
      keyId: "",
    },
  },
} as GcpSecretEnvironmentShape);
