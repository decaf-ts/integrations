# Nest Integration Helpers

`@decaf-ts/integrations/nest` exposes the framework glue that lets Decaf auth helpers run inside a Nest-style application boundary.

## What It Provides

- [`AuthService`](../../src/nest/authService.ts): JWT verification service with JWKS support.
- [`KeycloakAuthHandler`](../../src/nest/keycloakAuthHandler.ts): Keycloak token decoding, verification, namespace extraction, and request identity extraction. Extends `AuthHandler` from `@decaf-ts/for-http/server`.
- [`namespace`](../../src/nest/decorators.ts): Model decorator that stores namespace scopes for auth handlers.
- [`keycloakModule`](../../src/nest/keycloakModule.ts): module wiring for Nest consumers.
- `types.ts` and `utils.ts`: shared request and auth helper types.

## When To Use It

Use these helpers when you need:

- to extract a user identity from a Keycloak token
- to verify JWT signatures against the Keycloak JWKS endpoint
- to bridge Decaf request context into a Nest application
- to reuse the same auth, role, and namespace handling across HTTP handlers and Nest modules
- to attach namespace scopes to models with the integration-exported `namespace(...)` decorator

## Typical Usage

1. Import the Nest integration entry point.
2. Register the module that wires the auth service and handler.
3. Use the auth helper in your request pipeline or controller setup.

```ts
import { AuthService, KeycloakAuthHandler } from "@decaf-ts/integrations/nest";
```

## `AuthService`

JWT verification service supporting two modes:

- **Verify mode** (when `verifyToken: true` and `verifyUrl` is set): validates the JWT signature against the Keycloak JWKS endpoint using `jose.jwtVerify`.
- **Decode-only mode** (when `verifyToken: false` or `verifyUrl` is empty): decodes the JWT without signature verification (dev/local mode only).

### `AuthServiceOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `verifyToken` | `boolean` | `false` | Whether to verify the JWT signature against the Keycloak JWKS endpoint. When `false` (or `verifyUrl` is empty), tokens are decoded without signature verification (dev/local mode only). |
| `verifyUrl` | `string` | `""` | The Keycloak JWKS URL (e.g. `https://keycloak/realms/myrealm/protocol/openid-connect/certs`). Required when `verifyToken` is `true`. |
| `clockToleranceSeconds` | `number` | `5` | Clock tolerance for JWT expiry verification (in seconds). |
| `excludedClients` | `string[]` | `["account"]` | Keycloak client IDs to exclude when extracting roles from `resource_access`. |

```ts
const authService = new AuthService({
  verifyToken: true,
  verifyUrl: "https://keycloak/realms/myrealm/protocol/openid-connect/certs",
  clockToleranceSeconds: 10,
});
```

## `KeycloakAuthHandler`

Extends `AuthHandler<AuthExecutionContextLike, Context, KeycloakAuthData>` from `@decaf-ts/for-http/server`.

Overrides two extension points:

- `extractFromAuth(ctx)` — decodes the JWT and returns auth data (no validation). Returns empty data for public routes (`/public/*`) without requiring a token.
- `validate(data, routeRoles, routeNamespaces, skipModelNamespaces, model, ...args)` — validates the JWT via `AuthService.assertValidToken`, then delegates to the base class for route-level and model-level role and namespace checks. Skips entirely for public routes.

Does NOT override `bindToContext` — the base class default `ctx.accumulate(data)` is sufficient.

### Constructor

```ts
new KeycloakAuthHandler(authService?, authServiceOptions?)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `authService` | `AuthService` | — | Pre-configured auth service. When omitted, a new one is created from `authServiceOptions`. |
| `authServiceOptions` | `AuthServiceOptions` | `{}` | Used only when `authService` is omitted. |

### `KeycloakAuthData`

Extends `AuthData` with:

| Field | Type | Description |
|---|---|---|
| `user` | `string` | Normalized principal identifier used by downstream transformers and logging. |
| `email` | `string` | Raw JWT email claim, preserved for compatibility with transformers that still read `email`. |
| `preferred_username` | `string` | Raw JWT preferred username claim, preserved for compatibility. |
| `token` | `string` | The raw JWT extracted from the request. Empty for public routes. |
| `isPublic` | `boolean` | Whether the request targets a public route (skips validation). |
| `namespaces` | `string[]` | Namespace scopes extracted from `namespaces`, `namespace`, and `namespace:`-prefixed Keycloak roles. |

## Notes

- The helpers are intentionally framework-lean; they translate authentication concerns into Decaf-friendly request context objects.
- `KeycloakAuthHandler` is the main adapter when you need to read roles, namespaces, or identity from a Keycloak JWT.
- `getClientRoles` is re-exported for applications that need to inspect Keycloak client roles directly.
