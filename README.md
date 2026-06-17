# Decaf Integrations

`@decaf-ts/integrations` centralizes reusable helpers for Keycloak, Kibana, and Nest-style auth.

## Exports

- `@decaf-ts/integrations`
- `@decaf-ts/integrations/keycloak`
- `@decaf-ts/integrations/kibana`
- `@decaf-ts/integrations/nest`

## Included Modules

- Keycloak provisioning helpers for realms, users, roles, identity providers, and client-scoped role wiring.
- Kibana provisioning helpers for spaces, data views, dashboards, and realm-specific access control.
- Nest-style JWT helpers for extracting Keycloak roles and user context from access tokens.

## Notes

- Each subpath can be imported independently.
- Peer dependencies are marked optional so consumers only install what they actually use.
- The package is intended to be consumed from the Decaf workspace, but it is self-contained at the source level.
