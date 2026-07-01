/**
 * @module integrations/keycloak/types
 * @summary Keycloak configuration and payload types.
 * @description Shared type definitions for Keycloak provisioning services and their setup payloads.
 */
export interface KeycloakUser {
  realm: string;
  apiClientId: string;
  username: string;
  password: string;
  usernameUUID?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
  requiredActions?: string[];
  attributes?: Record<string, string[] | string>;
}

export interface KeycloakClientRoleConfig {
  roleName: string;
  claimValue: string;
  description?: string;
}

export interface KeycloakClientConfig {
  clientId: string;
  secret: string;
  clientName: string;
  description?: string;
  rootUrl?: string;
  adminUrl?: string;
  baseUrl?: string;
  redirectUris: string[];
  webOrigins: string[];
  clientUUID?: string;
  roles?: KeycloakClientRoleConfig[];
  enabled?: boolean;
  protocol?: string;
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  authorizationServicesEnabled?: boolean;
  publicClient?: boolean;
  frontchannelLogout?: boolean;
  consentRequired?: boolean;
  alwaysDisplayInConsole?: boolean;
  bearerOnly?: boolean;
  surrogateAuthRequired?: boolean;
  notBefore?: number;
  attributes?: Record<string, string>;
}

export interface KeycloakIdentityProviderConfig {
  alias: string;
  displayName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  providerId?: string;
  syncMode?: string;
  mapperSyncMode?: string;
  mapperClaimName?: string;
  enabled?: boolean;
  hideOnLogin?: boolean;
  linkOnly?: boolean;
  storeToken?: boolean;
  trustEmail?: boolean;
  updateProfileFirstLoginMode?: string;
  config?: Record<string, string>;
}

export interface KeycloakRealmConfig {
  realm?: string;
  enabled?: boolean;
  displayName?: string;
  displayNameHtml?: string;
  loginWithEmailAllowed?: boolean;
  duplicateEmailsAllowed?: boolean;
  resetPasswordAllowed?: boolean;
  registrationAllowed?: boolean;
  rememberMe?: boolean;
  verifyEmail?: boolean;
  attributes?: Record<string, string>;
}

export interface KeycloakClientConfigOverrides {
  payload?: Partial<Record<string, unknown>>;
}

export interface KeycloakUserConfigOverrides {
  payload?: Partial<Record<string, unknown>>;
}

export interface KeycloakIdentityProviderConfigOverrides {
  payload?: Partial<Record<string, unknown>>;
}

export interface KeycloakSetupConfig {
  id: string;
  host: string;
  protocol: "http" | "https";
  rootApiUser?: KeycloakUser;
  adminApiUser?: KeycloakUser;
  realmApiUser?: KeycloakUser;
  client: KeycloakClientConfig;
  identityProvider?: KeycloakIdentityProviderConfig;
  realmConfig?: KeycloakRealmConfig;
  /**
   * When true, realm roles are created as Keycloak composite roles forming a
   * hierarchy (e.g. admin ⊃ writer ⊃ reader).  A user assigned the composite
   * role automatically inherits all sub-roles in their JWT.
   *
   * When false (default), roles are independent — admin does NOT imply writer
   * or reader.  Each user must be explicitly granted every role they need.
   *
   * @default false
   */
  useCompositeRoles?: boolean;
}
