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
- `@decaf-ts/integrations/redis`
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
- Redis (and Redis-compatible, e.g. DragonflyDB) persistence adapter: `RedisAdapter`, `RedisRepository`, query statement/paginator, pub/sub event dispatch, and a `RedisContextLock` backing `@transactional()`.
- BI dashboard embed plugins (Kibana + Superset) with a shared DOM-free `DashboardEmbedPlugin` contract. The Kibana plugin is generated source + installer; the Superset plugin is a patch-and-build strategy that modifies Superset's internal embedded frontend and SDK source. Both expose the exact same API and are org-agnostic (no space switching).

## Redis adapter

The `./redis` export adds a Redis (and any Redis-compatible server, such as DragonflyDB) persistence adapter. Each model table is stored as a single Redis hash (`<prefix>:<table>`, default prefix `decaf:redis`) whose fields are record ids and whose values are serialized records. Because Redis hashes are not queryable, queries load the matching table and apply filtering, sorting, aggregation and pagination in JavaScript, mirroring the core RAM adapter.

```ts
import { RedisAdapter } from "@decaf-ts/integrations/redis";

const adapter = new RedisAdapter({ url: "redis://localhost:6379", user: "johndoe" });
await adapter.initialize();

const repo = new (adapter.repository<User>())(User, adapter);
await repo.create(new User({ name: "John" }));
```

`RedisConfig` accepts a full `url` connection string (it takes precedence) or the discrete `host`, `port`, `username`, `password`, and `database` fields, plus `prefix` (key namespace, defaults to `decaf:redis`) and `user` (identity stamped on created/updated records).

### Local test setup

`npm run prepare-it-tests` boots the DragonflyDB container from `docker/dragonfly-compose.yml` on `localhost:6379` (or run `docker compose -f docker/dragonfly-compose.yml up -d --wait` directly), then run the integration tests with `npm run test:integration`.

### Behaviour and limitations

- Queries are evaluated in JavaScript over loaded tables (RAM-adapter semantics); sorting and aggregation are not pushed down to the server.
- `@transactional()` is backed by `RedisContextLock`, which buffers writes on a dedicated connection and commits them atomically with `WATCH`/`MULTI`/`EXEC` optimistic locking.
- `createdBy`/`updatedBy` stamps require a user identity: pass `user` in the adapter config (or an explicit `UUID` flag), otherwise user identification throws `UnsupportedError`.
- Observer events are broadcast on the `decaf:redis:events` pub/sub channel so every process sharing the database refreshes its observers.

## Notes

- Each subpath can be imported independently.
- Peer dependencies are marked optional so consumers only install what they actually use.
- The package is intended to be consumed from the Decaf workspace, but it is self-contained at the source level.
