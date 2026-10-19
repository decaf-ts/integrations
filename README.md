# Decaf Integrations

`@decaf-ts/integrations` centralizes reusable helpers for Keycloak, Kibana, Nest-style auth, and org-based authorization scaffolding.

## Exports

- `@decaf-ts/integrations`
- `@decaf-ts/integrations/keycloak`
- `@decaf-ts/integrations/kibana`
- `@decaf-ts/integrations/nest`
- `@decaf-ts/integrations/namespaces`
- `@decaf-ts/integrations/feature-flags`
- `@decaf-ts/integrations/redis`
- `@decaf-ts/integrations/sftp`
- `@decaf-ts/integrations/comms` (+ `comms/{email,gmail,slack,teams,telegram}`)
- `@decaf-ts/integrations/devops` (+ `devops/{github,gitlab}`)
- `@decaf-ts/integrations/io` (+ `io/{airtable,google-sheets,graphql,spreadsheet}`)
- `@decaf-ts/integrations/shared/http`
- `@decaf-ts/integrations/loader`
- `@decaf-ts/integrations/plugins`
- `@decaf-ts/integrations/plugins/kibana`
- `@decaf-ts/integrations/plugins/superset`

## Included Modules

- Keycloak provisioning helpers for realms, users, roles, identity providers, and client-scoped role wiring.
- Kibana provisioning helpers for spaces, data views, dashboards, and realm-specific access control, including a fluent `KibanaIndexBuilder` (Builder Pattern) for constructing index pattern configurations with exact match, prefix/glob, and logger-generated matching modes.
- Nest-style JWT helpers for extracting Keycloak roles, namespace scopes, and user context from access tokens, plus the `namespace(...)` model decorator for auth-scoped metadata.
- Org-based authorization scaffolds for tenants, org units, principals, roles, permissions, grants, effective permissions, storage bindings, and authorization payload filters.
- Feature-flag models, readers, services, decorators, and environment helpers, including the engine-capability-derived `EngineCapabilityFeatureFlagService` (see [Feature flags](#feature-flags)).
- Dynamic object-loading helpers for models, adapters, repositories, services, controllers, environment objects, and Angular components.
- Redis (and Redis-compatible, e.g. DragonflyDB) persistence adapter: `RedisAdapter`, query statement/paginator, pub/sub event dispatch, and a `RedisContextLock` backing `@transactional()`.
- SFTP client helpers for list/download/delete over an SSH connection (used by the `core.devops.ftp` graph node).
- BI dashboard embed plugins (Kibana + Superset) with a shared DOM-free `DashboardEmbedPlugin` contract. The Kibana plugin is generated source + installer; the Superset plugin is a patch-and-build strategy that modifies Superset's internal embedded frontend and SDK source. Both expose the exact same API and are org-agnostic (no space switching).

## Communication, DevOps, and IO services

The graph node families added in SAA-1027 stage 3b wrap these service classes. Every service extends `HttpApiService` (Axios transport, decaf errors) except `SpreadsheetService`, which is local computation. Config resolves from explicit `initialize({...})` arguments, then from the matching `CommsEnvironment`/`DevopsEnvironment`/`IoEnvironment` slice; secrets are read from the environment or supplied by the caller and are never embedded in a graph document.

| Export | Service | Config environment | Operations |
| --- | --- | --- | --- |
| `comms/slack` | `SlackService` | `COMMS_SLACK_TOKEN`, `COMMS_SLACK_BASE_URL`, `COMMS_SLACK_TIMEOUT` | post message, list/get conversations, get user |
| `comms/telegram` | `TelegramService` | `COMMS_TELEGRAM_TOKEN`, `COMMS_TELEGRAM_BASE_URL`, `COMMS_TELEGRAM_TIMEOUT` | send message, get metadata, get updates, chat action |
| `comms/teams` | `TeamsService` | `COMMS_TEAMS_TOKEN`, `COMMS_TEAMS_WEBHOOK_URL`, `COMMS_TEAMS_BASE_URL`, `COMMS_TEAMS_TIMEOUT` | webhook post, channel message, list teams/channels |
| `comms/gmail` | `GmailService` | `COMMS_GMAIL_TOKEN`, `COMMS_GMAIL_USER_ID`, `COMMS_GMAIL_BASE_URL`, `COMMS_GMAIL_TIMEOUT` | send, list/get messages, list labels |
| `comms/email` | `EmailService` | `COMMS_EMAIL_*` (provider, host, port, secure, username, password, from, token, graph base URL) | SMTP send, Graph send/list inbox, IMAP list (optional `imapflow`) |
| `devops/github` | `GithubService` | `DEVOPS_GITHUB_*` (token, base URL, owner, repo) | repository, issues, comments, pull requests |
| `devops/gitlab` | `GitlabService` | `DEVOPS_GITLAB_*` (token, base URL, project ID) | project, issues, comments, merge requests |
| `io/google-sheets` | `GoogleSheetsService` | `IO_GOOGLE_SHEETS_*` (token/api key, base URL) | get/update/append/clear values, create spreadsheet |
| `io/airtable` | `AirtableService` | `IO_AIRTABLE_*` (token, base URL, base ID) | list/get/create/update/delete records |
| `io/graphql` | `GraphqlService` | `IO_GRAPHQL_*` (endpoint, token) | query/mutation request |
| `io/spreadsheet` | `SpreadsheetService` | none (local) | parse/serialize CSV, TSV, and JSON |

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

## Feature flags

The `./feature-flags` export (also re-exported from the package root) provides feature-flag models, readers, a repository/environment-backed `FeatureFlagService`, access-control decorators, and the capability-derived `EngineCapabilityFeatureFlagService`.

`EngineCapabilityFeatureFlagService` is a `FeatureFlagService` subclass whose flag values are derived exclusively from a served graph-engine capability manifest — the same shape the as-graph server serves at `GET /graph/engines` (per engine: `engineId` plus `capabilities: [{ feature, verdict }]`, and `defaultEngineId`). Flags are never read from the environment and never from the persistence repository: `syncFromEnvironment()` fails closed with an `InternalError` instead of reading the environment.

Resolution is fail-closed:

- An engine key (`engine<Pascal(engineId)>`) is enabled when the engine appears in the manifest.
- A feature key (`engine<Pascal(engineId)><Pascal(feature)>`) is enabled **only** when the manifest declares that feature `SUPPORTED`. `NOT_SUPPORTED` and `EXTENSION_POINT` verdicts, and features absent from the manifest, resolve to disabled.
- Build keys with the `engineCapabilityFlagKey(engineId, feature?)` helper rather than assembling them by hand, or derive a whole registry from a manifest with `engineCapabilityFlagRegistry(manifest)`.

```ts
import { EngineCapabilityFeatureFlagService } from "@decaf-ts/integrations/feature-flags";

const flags = new EngineCapabilityFeatureFlagService();
await flags.initialize({
  manifest: {
    engines: [
      {
        engineId: "local",
        capabilities: [
          { feature: "codeMode", verdict: "SUPPORTED" },
          { feature: "workflowList", verdict: "SUPPORTED" },
          { feature: "workflowLookup", verdict: "SUPPORTED" },
        ],
      },
      {
        engineId: "dagster",
        capabilities: [{ feature: "suspendResume", verdict: "NOT_SUPPORTED" }],
      },
    ],
    defaultEngineId: "local",
  },
});

flags.isEngineEnabled("local");                        // true
flags.isEngineFeatureEnabled("local", "codeMode");     // true
flags.isEngineFeatureEnabled("dagster", "suspendResume"); // false (fail closed)
flags.isEngineFeatureEnabled("mastra", "pinning");     // false (undeclared engine)
flags.isEnabled("engineLocalWorkflowList");            // true
```

The manifest input is a structural subset of the as-graph manifest, so no import of the as-graph package is required and the dependency direction is preserved. All read paths (`isEnabled`, `resolveFeatureFlags`, `isEnabledForSubject`, `resolveFeatureFlagsForSubject`) resolve against the derived registry only, and `listEnabled()` returns the enabled flags as `FeatureFlag` models without touching a repository.

## Notes

- Each subpath can be imported independently.
- Peer dependencies are marked optional so consumers only install what they actually use.
- The package is intended to be consumed from the Decaf workspace, but it is self-contained at the source level.
