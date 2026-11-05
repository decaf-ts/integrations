/**
 * @module integrations/secrets/kubernetes/config
 * @summary Kubernetes secret service configuration.
 * @description Configuration schema for the native Kubernetes Secrets integration,
 * including kubeconfig selection, explicit API-server credentials, and the
 * default namespace used by every operation.
 */

import { SecretServiceConfig } from "../../secrets/core";

export interface KubernetesSecretServiceConfig extends SecretServiceConfig {
  provider: "kubernetes";
  /**
   * @description Namespace that owns the secrets.
   * @summary Defaults to the namespace of the active kubeconfig context, then
   * to `default`. Individual operations may override it through their options.
   */
  namespace?: string;
  /**
   * @description Path to a kubeconfig file.
   * @summary When omitted the client falls back to `KUBECONFIG`,
   * `~/.kube/config`, and finally in-cluster service-account configuration.
   */
  kubeconfig?: string;
  /**
   * @description Kubeconfig context to select after loading.
   */
  context?: string;
  /**
   * @description Explicit Kubernetes API server URL.
   * @summary When present the client is built from the explicit server,
   * token/certificate fields, and namespace instead of a kubeconfig file.
   */
  server?: string;
  token?: string;
  tokenFile?: string;
  caFile?: string;
  /**
   * @description Base64 encoded PEM certificate authority bundle.
   */
  caData?: string;
  certFile?: string;
  keyFile?: string;
  certData?: string;
  keyData?: string;
  skipTLSVerify?: boolean;
  /**
   * @description Force loading the in-cluster service-account configuration.
   */
  serviceAccount?: boolean;
}
