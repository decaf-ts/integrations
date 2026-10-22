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
- Namespaced credential management: `Credential` model + `CredentialService` storing secret values encrypted at rest via the model-backed `ModelSecretService`, plus the namespace RLS template/bootstrap (`RlsBootstrapService`, `runAsPrincipal`) — see [Credentials and namespace RLS](#credentials-and-namespace-rls).
- Filesystem-backed `FsSecretService` (encrypted `decaf.fs-secret.v1` envelopes, never enumerable) with `InfraCredentialBootstrap.ensure()` for infrastructure credentials — see [Credentials and namespace RLS](#credentials-and-namespace-rls).
- Plain undecorated service classes for every comms/devops/io/blob/secret/HTTP service: construct them directly and boot with an explicit `await instance.boot(config)`, or — on the graph-node path — boot Environment-hermetically with `bootWithoutEnvironment(service, config)` — see [Constructing and booting services](#constructing-and-booting-services).

## Communication, DevOps, and IO services

The graph node families added in SAA-1027 stage 3b construct these service classes directly. Every service extends `HttpApiService` (Axios transport, decaf errors) except `SpreadsheetService`, which is local computation. Consumers construct the service and boot it with an explicit configuration object (`await instance.boot(config)` — see [Constructing and booting services](#constructing-and-booting-services)); the explicit config wins over the matching `CommsEnvironment`/`DevopsEnvironment`/`IoEnvironment` slice, and secrets are read from the environment or supplied by the caller, never embedded in a graph document. Graph-node execution must not inherit these environment slices: node consumers boot through `bootWithoutEnvironment` instead of plain `.boot(config)` — see [Constructing and booting services](#constructing-and-booting-services).

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

## Credentials and namespace RLS

The `./namespaces` export adds namespaced credential management and the row-level-security bootstrap on top of the authorization scaffold.

**Credential management.** The `Credential` model is the namespaced credential *metadata* record (tenant / org unit / owner principal, name, credential type, provider, expiry); the secret value itself is stored encrypted at rest through the model-backed `ModelSecretService` (`@decaf-ts/crypto` AES envelopes, RLS-scoped `secrets` rows). `ModelSecretService` enforces `(name, version)` uniqueness: `store` and `rotate` reject a combination already held by another row with a `SECRET_ALREADY_EXISTS` error before writing (`rotate` excludes the row being updated), and name-based operations (`retrieve`, `delete`, `metadata`, `rotate`) resolve the newest `updatedAt` row deterministically when several match. `CredentialService` manages the lifecycle — `createCredential`, `rotateCredential`, `getCredential`, `listCredentials`, `markCredentialUsed`, `deleteCredential` — and deliberately exposes no `resolveCredentialSecret`-style retrieval: secret values resolve through the context-bound, RLS-restricted secret path.

**Namespace RLS.** `sql/002_rls.sql` is generated from `src/namespaces/rls/rls.template.ts` (never edit it by hand) and enforces reader/writer/admin semantics (`namespace.read` / `namespace.write` / `namespace.admin` permission keys; `namespace-reader` / `namespace-writer` / `namespace-admin` default role keys) across the org-unit closure and principal identity: readers see content tables only, writers additionally write non-administrative rows, admins see everything (administrative tables — `permissions`, `roles`, `role_permissions`, `role_assignments`, `inheritance_blocks`, `storage_bindings` — are admin-only), and users always see their own identity rows and their own credentials/secrets.

```ts
import {
  CredentialService,
  RlsBootstrapService,
  runAsPrincipal,
} from "@decaf-ts/integrations/namespaces";
import pg from "pg";

// Apply the generated RLS template through any pg-shaped executor.
const admin = new pg.Client({ connectionString: process.env.DECAF_PG_URL });
await admin.connect();
const rls = await new RlsBootstrapService().boot(admin);
await rls.apply();                       // idempotent; safe on every deployment

// Bind the acting principal for request-scoped reads (transaction-local).
await rls.setPrincipal(principalId);

// ...or run a callback inside a transaction with the principal bound
// (rolls back by default; pass { commit: true } for real writes).
await runAsPrincipal(admin, principalId, async (executor) => {
  /* RLS-scoped queries */
});

// Credential lifecycle (secret value encrypted at rest via ModelSecretService).
const credentials = new CredentialService();
const credential = await credentials.createCredential({
  tenantId,
  name: "smtp-relay",
  credentialType: "smtp",
  secret: { host: "...", username: "...", password: "..." },
});
```

SQL prerequisites (in order): `sql/001_constraints.sql` (namespace schema), `sql/004_credentials.sql` (credential/secret namespacing columns + indexes; the unique `uq_secrets_name_version (name, coalesce(version, ''))` index enforces one row per `(name, version)` — versions are optional, so `NULL` versions collapse to `''` — and a fail-closed guard aborts the script while legacy duplicate `(name, version)` rows exist), then `sql/002_rls.sql` (RLS template — applied via `RlsBootstrapService.apply()` or a migration runner; `apply()` requires the connecting role to be `SUPERUSER` or `BYPASSRLS` and fails closed with an `RlsFunctionOwnerError` before any DDL otherwise) before request-scoped traffic reaches the database.

**Infrastructure credentials.** The `./secrets` export adds `FsSecretService` — a filesystem-backed, AES-encrypted (`decaf.fs-secret.v1` envelopes, `0o700` root / `0o600` files, default `.decaf/secrets`) secret store for infrastructure credentials. It is never enumerable (`list`/`metadata` throw) and is configured through the `secrets.fs` Environment slice (`rootPath`, `keySecret`, `keyId`) or an explicit boot config; the `keySecret` is mandatory. `InfraCredentialBootstrap.ensure(seeds)` seeds infra credentials idempotently at initialization time, and `retrieve(name)` reads a value immediately before use:

```ts
import { createInfraCredentialBootstrap } from "@decaf-ts/integrations/secrets";

const infra = await createInfraCredentialBootstrap({ keySecret: "infra-master-key" });
await infra.ensure([{ name: "smtp/relay", value: { host: "...", password: "..." } }]);
const { host, password } = await infra.retrieve("smtp/relay");
```

## SMTP email delivery

`@decaf-ts/integrations/comms/email` exports `SmtpClient` (also via the `./smtp` subpath). `SmtpClient` delegates the SMTP protocol to the optional **`nodemailer`** peer (the same library n8n uses) instead of hand-rolling the wire protocol, while keeping the same `connect`/`send`/`close` surface over a pre-built raw MIME message:

- `secure: true` opens an implicit-TLS socket from the first byte (default port `465`); `secure: false` (default) connects in plaintext and upgrades via STARTTLS (default port `587`).
- Fail-closed plaintext AUTH: with credentials configured, the session must be encrypted before `AUTH LOGIN` is attempted; `allowPlaintextAuth` is the explicit opt-out for servers that cannot offer TLS.
- Envelope addresses are validated before they reach any SMTP command.

```ts
import { SmtpClient, buildEmail } from "@decaf-ts/integrations/comms/email";

const client = new SmtpClient({
  host: "smtp.example.com",
  port: 587,
  username: "noreply@example.com",
  password: process.env.SMTP_PASSWORD,
});
await client.connect();
const mail = buildEmail({ from: "noreply@example.com", to: ["ops@example.com"], subject: "Nightly report", text: "All systems nominal." });
await client.send(mail.from, mail.recipients, mail.raw);
await client.close();
```

`EmailService` is a plain undecorated class: construct it directly and boot it with an explicit configuration object (see [Constructing and booting services](#constructing-and-booting-services)). `EmailService` resolution is fail-closed on plaintext AUTH: after merging the explicit config over the `comms.email` environment slice, `initialize()` defaults an unresolved `allowPlaintextAuth` to `false`, so credentials are only sent over a TLS-protected session unless the effective config explicitly opts in — an environment-only `allowPlaintextAuth: true` no longer reaches a boot whose explicit config omits the key (for the fully environment-free node path, see [Hermetic boot for node consumers](#hermetic-boot-for-node-consumers)).

## Constructing and booting services

The comms/devops/io/blob/secret/HTTP services are plain undecorated classes — no `@service()` registration, no auto-singleton, and no auto-boot. Construct the service directly and call `boot(config)` with an explicit configuration object:

```ts
import { SlackService } from "@decaf-ts/integrations/comms/slack";

const slack = await new SlackService().boot({ token: process.env.SLACK_TOKEN });
```

`boot(config)` delegates to `initialize()`, which merges the explicit config over any values resolvable from the matching `CommsEnvironment`/`DevopsEnvironment`/`IoEnvironment` slice; the explicit object always wins. For fully explicit, environment-free configuration, pass every required field in the boot config object.

### Hermetic boot for node consumers

Plain `.boot(config)` merges the matching Environment slice under the explicit config — keys absent from the config object inherit their Environment values. That is the intended behavior for application code, but graph-node execution must stay Environment-hermetic (SAA-1305 finding F1): a node booting `EmailService` must not silently pick up an environment `comms.email.allowPlaintextAuth=true` opt-in, and an Environment `timeout` must not reach an `HttpApiService` node boot.

`@decaf-ts/integrations/shared/http` therefore exports `bootWithoutEnvironment(service, config, ...rest)`, which boots a service with Environment-derived configuration disabled for that one call:

```ts
import { EmailService } from "@decaf-ts/integrations/comms/email";
import { bootWithoutEnvironment } from "@decaf-ts/integrations/shared/http";

// The comms.email environment slice is ignored for this boot:
// allowPlaintextAuth stays false unless the explicit config sets it.
const email = await bootWithoutEnvironment(new EmailService(), {
  provider: "smtp",
  host: "smtp.example.com",
  port: 587,
  username: "noreply@example.com",
  password: process.env.SMTP_PASSWORD,
});
```

- **Fail closed:** the explicit config object is mandatory — a missing or non-object config throws a `ValidationError` instead of falling back to Environment configuration.
- **No Environment for that boot:** the service's own `configFromEnvironment()` hook is shadowed with `() => undefined` for the duration of the single `boot()` call, so keys absent from the explicit config stay unset instead of inheriting the Environment slice.
- **Restored afterward:** the original `configFromEnvironment()` descriptor is put back (or removed, when the service had none) in a `finally` block after the boot; the shadowing is per-instance and never touches the prototype, so other service instances are unaffected and teardown stays safe.
- **Same boot contract:** remaining `boot()` arguments (e.g. a decaf `Context`) are forwarded unchanged, and the same service instance is returned, booted.

All 13 as-graph node kinds that boot integrations services (comms, devops, io, and storage/blob) boot through this helper — use it for any node-side or automated boot where Environment-derived configuration must not leak into the explicit boot config. Plain `.boot(config)` remains correct for application code that wants the environment merge.

## Optional peer dependencies

Two new optional peers were added (`peerDependenciesMeta` marks both optional; each is also a dev dependency):

| Peer | Needed for |
|:-----|:-----------|
| `nodemailer` (`>=7.0.0`) | SMTP delivery (`SmtpClient`, `EmailService` SMTP path). Install: `npm i nodemailer`. |
| `pg` (`>=8.0.0`) | Namespace RLS / credential / model-secret integration tests and applications driving the RLS bootstrap against Postgres. Install: `npm i pg`. |

## Integration-test infrastructure

`npm run prepare-it-tests` boots all Dockerized IT infrastructure with `--wait` health gating:

- `docker/dragonfly-compose.yml` — DragonflyDB (Redis-compatible) on `localhost:6379` (Redis adapter ITs).
- `docker/postgres-compose.yml` — `postgres:16` on host port `55435`, db `decaf_integration`, user `decaf` (RLS matrix, credential, and model-secret ITs; override the connection string with `DECAF_PG_URL`, default `postgresql://decaf:decaf-integration@localhost:55435/decaf_integration`).
- `docker/mailpit-compose.yml` — Mailpit SMTP sink on `1025` (HTTP API/UI on `8025`), accepting any AUTH including plaintext so the SMTP credential path is exercisable locally (Email ITs).

Run the integration tests with `npm run test:integration`.

## Notes

- Each subpath can be imported independently.
- Peer dependencies are marked optional so consumers only install what they actually use.
- The package is intended to be consumed from the Decaf workspace, but it is self-contained at the source level.
