import { SecretServiceConfig } from "../../secrets/core";

export interface GcpSecretManagerServiceConfig extends SecretServiceConfig {
  provider: "gcp-secret-manager";
  projectId: string;
  credentials?: any;
  /** Override the Secret Manager API host, e.g. to point at a local emulator. */
  apiEndpoint?: string;
  /** Port to use with apiEndpoint. Defaults to the gRPC default (443) if omitted. */
  port?: number;
}
