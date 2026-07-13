# Decaf Integrations

`@decaf-ts/integrations` centralizes reusable helpers for Keycloak, Kibana, Nest-style auth, and org-based authorization scaffolding.

## Exports

- `@decaf-ts/integrations`
- `@decaf-ts/integrations/keycloak`
- `@decaf-ts/integrations/kibana`
- `@decaf-ts/integrations/nest`
- `@decaf-ts/integrations/namespaces`
- `@decaf-ts/integrations/loader`
- `@decaf-ts/integrations/plugins`
- `@decaf-ts/integrations/plugins/kibana`
- `@decaf-ts/integrations/plugins/superset`

## Included Modules

- Keycloak provisioning helpers for realms, users, roles, identity providers, and client-scoped role wiring.
- Kibana provisioning helpers for spaces, data views, dashboards, and realm-specific access control, including a fluent `KibanaIndexBuilder` (Builder Pattern) for constructing index pattern configurations with exact match, prefix/glob, and logger-generated matching modes.
- Nest-style JWT helpers for extracting Keycloak roles, namespace scopes, and user context from access tokens, plus the `namespace(...)` model decorator for auth-scoped metadata.
- Org-based authorization scaffolds for tenants, org units, principals, roles, permissions, grants, effective permissions, storage bindings, and authorization payload filters.
- Dynamic object-loading helpers for models, adapters, repositories, services, controllers, environment objects, Angular components, and graph nodes.
- BI dashboard embed plugins (Kibana + Superset) with a shared DOM-free `DashboardEmbedPlugin` contract. The Kibana plugin is generated source + installer; the Superset plugin is a patch-and-build strategy that modifies Superset's internal embedded frontend and SDK source. Both expose the exact same API and are org-agnostic (no space switching).

## Notes

- Each subpath can be imported independently.
- Peer dependencies are marked optional so consumers only install what they actually use.
- The package is intended to be consumed from the Decaf workspace, but it is self-contained at the source level.
