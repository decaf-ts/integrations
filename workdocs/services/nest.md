# Nest Integration Helpers

`@decaf-ts/integrations/nest` exposes the framework glue that lets Decaf auth helpers run inside a Nest-style application boundary.

## What It Provides

- [`AuthService`](../../src/nest/authService.ts): request-context-aware auth helper.
- [`keycloakAuthHandler`](../../src/nest/keycloakAuthHandler.ts): Keycloak token decoding and request identity extraction.
- [`keycloakModule`](../../src/nest/keycloakModule.ts): module wiring for Nest consumers.
- `types.ts` and `utils.ts`: shared request and auth helper types.

## When To Use It

Use these helpers when you need:

- to extract a user identity from a Keycloak token
- to bridge Decaf request context into a Nest application
- to reuse the same auth and role handling across HTTP handlers and Nest modules

## Typical Usage

1. Import the Nest integration entry point.
2. Register the module that wires the auth service and handler.
3. Use the auth helper in your request pipeline or controller setup.

```ts
import { AuthService, keycloakModule } from "@decaf-ts/integrations/nest";
```

## Notes

- The helpers are intentionally framework-lean; they translate authentication concerns into Decaf-friendly request context objects.
- `keycloakAuthHandler` is the main adapter when you need to read roles or identity from a Keycloak JWT.
