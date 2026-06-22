import { SecretServiceConfig } from "../../secrets/core";

export interface GcpSecretManagerServiceConfig extends SecretServiceConfig {
  provider: "gcp-secret-manager";
  projectId: string;
  credentials?: any;
}
