# Decaf Integrations

`@decaf-ts/integrations` centralizes reusable helpers for Keycloak, Kibana, Nest-style auth, and org-based authorization scaffolding.

## Exports

- `@decaf-ts/integrations`
- `@decaf-ts/integrations/graph`
- `@decaf-ts/integrations/graph/shared`
- `@decaf-ts/integrations/nest/graph`
- `@decaf-ts/integrations/keycloak`
- `@decaf-ts/integrations/kibana`
- `@decaf-ts/integrations/nest`
- `@decaf-ts/integrations/namespaces`
- `@decaf-ts/integrations/loader`
- `@decaf-ts/integrations/plugins`
- `@decaf-ts/integrations/plugins/kibana`
- `@decaf-ts/integrations/plugins/superset`

## Included Modules

- Graph engine, backend node catalogue, and run lifecycle (DECAF-50). The engine executes canonical `GraphWorkflowDocument`s only: the nine-stage validation gate resolves every node kind against the trusted backend catalogue, rejects inline client definitions (`node`/`definition`/`executor`/`execute`/`ports`/`component` fields), and rejects unsafe prototype keys (`__proto__`/`prototype`/`constructor`). Node executors implement the §4.9 request contract (`GraphNodeExecutionRequest` separates `parameters`/`credentials`/`metadata` from `inputs`); the legacy input-only executor adapter was removed at the P7 cutover. The Nest module exposes the catalogue API (`GET /graph/node-types*`), document persistence (`PUT|GET /graph/workflows/{id}`, `POST /graph/workflows/validate`), and the asynchronous run lifecycle (`POST /graph/runs` → `202` with `eventsUrl`/`resultUrl`, run-scoped authorized replayable SSE via `GET /graph/runs/{runId}/events`, `DELETE /graph/runs/{runId}` for cancellation). `POST /graph/execute` and the global `GET /graph/events` stream are deprecated (kept, not removed): the run lifecycle is the primary execution path. The `GRAPH_CANONICAL_DOCUMENT_ENABLED` rollout flag was removed at cutover — the canonical path is the sole default.
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
