# Keycloak Services

`@decaf-ts/integrations/keycloak` provides a staged provisioning flow for Keycloak. The top-level [`KeycloakService`](../../src/keycloak/services/KeycloakService.ts) coordinates the lower-level realm, user, role, client, identity-provider, and auth services.

## When To Use It

Use this package when you need to:

- create or update realms
- create service accounts and realm users
- assign realm or client roles
- provision clients and identity providers
- fetch admin access tokens for downstream provisioning

## Core Flow

1. Create a `KeycloakService`.
2. Call `initialize(config)` with a `KeycloakSetupConfig`.
3. Use `setupKeycloak(config)` for the full bootstrap flow, or call the narrower methods when you only need one concern.

```ts
import { KeycloakService } from "@decaf-ts/integrations/keycloak";

const service = new KeycloakService();
await service.initialize({
  protocol: "https",
  host: "keycloak.example.com",
  realm: "acme",
  adminApiUser: {
    realm: "master",
    username: "admin",
    password: process.env.KEYCLOAK_ADMIN_PASSWORD!,
  },
  rootApiUser: {
    realm: "master",
    username: "root",
    password: process.env.KEYCLOAK_ROOT_PASSWORD!,
  },
});
```

## Service Responsibilities

- [`KeycloakRealmService`](../../src/keycloak/services/KeycloakRealmService.ts): create, edit, and delete realms.
- [`KeycloakUserService`](../../src/keycloak/services/KeycloakUserService.ts): create users, edit users, remove users, and manage realm membership.
- [`KeycloakRoleService`](../../src/keycloak/services/KeycloakRoleService.ts): grant realm roles and client roles to users.
- [`KeycloakClientService`](../../src/keycloak/services/KeycloakClientService.ts): resolve client UUIDs and configure client-level access.
- [`KeycloakIdentityProviderService`](../../src/keycloak/services/KeycloakIdentityProviderService.ts): manage identity providers.
- [`KeycloakAuthService`](../../src/keycloak/services/KeycloakAuthService.ts): fetch access tokens for other calls.

## Typical Usage

### Full bootstrap

Use `setupKeycloak()` when you want the service to provision the admin API user and grant it realm access.

```ts
const config = await service.setupKeycloak(setupConfig);
```

### Organization provisioning

Use `setupOrganization()` when the realm, client, roles, users, and dashboards are part of a single tenant bootstrap step.

```ts
await service.setupOrganization(setupConfig);
```

### Targeted operations

Use the delegated methods when you only need one change:

- `addRealm`, `editRealm`, `removeRealm`
- `addUserToRealm`, `editUser`, `removeUserFromRealm`
- `addRealmRolesToUser`, `addClientRolesToUser`
- `deleteAdminApiUser`

## Logging And Errors

- Every method participates in the Decaf contextual logging flow through `logCtx(...)`.
- Errors are translated into Decaf errors at the service boundary.
- `parseError()` is intentionally protected and only used to convert foreign errors into Decaf errors.

## Notes

- The service expects a Keycloak admin API user and a root API user in the config.
- The low-level services are instantiated during `initialize()`; do not bypass that step.
