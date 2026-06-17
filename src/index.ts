export {
  KeycloakService,
  createKeycloakSetupConfig,
  createKeycloakClientConfig,
  createKeycloakIdentityProviderConfig,
  splitList,
} from "./keycloak";
export { KibanaService, createKibanaSetupConfig } from "./kibana";
export { AuthService, KeycloakAuthHandler, AuthModule, KeycloakModule, DECAF_ADAPTER_OPTIONS } from "./nest";

/**
 * @summary Decaf integrations module.
 * @description Centralized integration helpers for Keycloak, Kibana, and Nest-style auth.
 * @module integrations
 */

/**
 * @summary Package version.
 * @description Replaced during the build.
 * @const VERSION
 * @memberOf module:integrations
 */
export const VERSION = "##VERSION##";
