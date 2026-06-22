/**
 * @module integrations/secrets/model/config
 * @summary Model-backed secret service configuration.
 * @description Configuration schema for the encrypted-at-rest model secret service.
 */
export interface ModelSecretServiceConfig {
  provider: "model";
  keySecret: string;
  keyId?: string;
}
