/**
 * @module integrations/secrets/model/config
 * @summary Model-backed secret service configuration.
 * @description Configuration schema for the encrypted-at-rest model secret service.
 */
import { SecretServiceConfig } from "../core";

export interface ModelSecretServiceConfig extends SecretServiceConfig {
  provider: "model";
  keySecret: string;
  keyId?: string;
}
