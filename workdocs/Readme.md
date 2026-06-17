# Decaf Integrations

`@decaf-ts/integrations` centralizes the reusable integration helpers used by Decaf services.

## Exports

- `@decaf-ts/integrations`
- `@decaf-ts/integrations/keycloak`
- `@decaf-ts/integrations/kibana`
- `@decaf-ts/integrations/nest`

## What is included

- Keycloak provisioning helpers for realms, users, roles, identity providers, and clients.
- Kibana provisioning helpers for spaces, data views, dashboards, and role/user setup.
- Nest-style auth helpers for decoding Keycloak JWTs and extracting roles and user context.

## Installation

The package is designed to be used with the surrounding Decaf workspace. Peer dependencies are optional so consumers can install only the integration subpaths they need.

## Usage

```ts
import { KeycloakService } from "@decaf-ts/integrations/keycloak";
import { KibanaService } from "@decaf-ts/integrations/kibana";
import { AuthService } from "@decaf-ts/integrations/nest";

const auth = new AuthService();
```
