/**
 * @module integrations/secrets/kubernetes/environment
 * @summary Kubernetes secret environment.
 * @description Extends the common secrets environment with the `secrets.kubernetes`
 * shape matching {@link KubernetesSecretServiceConfig}, so
 * {@link KubernetesSecretService} can fall back to it when no config is passed to
 * `initialize`.
 */

import { SecretEnvironment } from "../core/SecretEnvironment";

export interface KubernetesSecretEnvironmentConfig {
  namespace?: string;
  kubeconfig?: string;
  context?: string;
  server?: string;
  token?: string;
  tokenFile?: string;
  caFile?: string;
  caData?: string;
  certFile?: string;
  keyFile?: string;
  certData?: string;
  keyData?: string;
  skipTLSVerify?: boolean;
  serviceAccount?: boolean;
}

export interface KubernetesSecretEnvironmentShape {
  secrets: {
    kubernetes: KubernetesSecretEnvironmentConfig;
  };
}

export const KubernetesSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    kubernetes: {
      namespace: "",
      kubeconfig: "",
      context: "",
      server: "",
      token: "",
      tokenFile: "",
      caFile: "",
      caData: "",
      certFile: "",
      keyFile: "",
      certData: "",
      keyData: "",
      skipTLSVerify: false,
      serviceAccount: false,
    },
  },
} as KubernetesSecretEnvironmentShape);
