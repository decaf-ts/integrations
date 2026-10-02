# Decaf Integrations

`@decaf-ts/integrations` centralizes the reusable integration helpers used by Decaf services.

## Exports

- `@decaf-ts/integrations`
- `@decaf-ts/integrations/keycloak`
- `@decaf-ts/integrations/kibana`
- `@decaf-ts/integrations/nest`
- `@decaf-ts/integrations/redis`

## What is included

- Keycloak provisioning helpers for realms, users, roles, identity providers, and clients.
- Kibana provisioning helpers for spaces, data views, dashboards, and role/user setup.
- Nest-style auth helpers for decoding Keycloak JWTs and extracting roles and user context.
- Redis (and Redis-compatible, e.g. DragonflyDB) persistence adapter: `RedisAdapter`, `RedisRepository`, query statement/paginator, pub/sub event dispatch, and a `RedisContextLock` backing `@transactional()`.
- Docker Compose orchestration for local containerized environments.
- Secret service abstractions and provider implementations for model-backed storage, AWS, Azure, GCP, Vault, and 1Password.

## Service Guides

- [Keycloak](./services/keycloak.md)
- [Kibana](./services/kibana.md)
- [Nest](./services/nest.md)
- [Namespaces](./5-HowToUse.md)
- [Secrets](./services/secrets.md)
- [Docker Compose](./services/docker-compose.md)

## Installation

The package is designed to be used with the surrounding Decaf workspace. Peer dependencies are optional so consumers can install only the integration subpaths they need.

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

## Usage

```ts
import { KeycloakService } from "@decaf-ts/integrations/keycloak";
import { KibanaService } from "@decaf-ts/integrations/kibana";
import { AuthService } from "@decaf-ts/integrations/nest";

const auth = new AuthService();
```
