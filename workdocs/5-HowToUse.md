### How to Use

`@decaf-ts/integrations/namespaces` exposes the org-based authorization scaffold used by Decaf-TS. Import the namespace entry point when you need tenants, org units, principals, roles, permissions, grants, effective permissions, storage bindings, or runtime access checks.

Prerequisites:
- Postgres schema and migrations for the namespace tables
- The SQL artifacts in `integrations/sql/001_constraints.sql`, `integrations/sql/002_rls.sql`, and `integrations/sql/003_indexes.sql`
- A trusted application layer that resolves subjects to principals at auth-priming time and carries `principalId` on the request context — the `@decaf-ts/for-typeorm` adapter binds `app.principal_id` transaction-locally for RLS-scoped reads (see [RLS requirements](#rls-requirements))

## Public surface

Importing the namespace entry point gives you:

- `types`: enums and DTOs such as `IsolationTier`, `MembershipStatus`, `PrincipalKind`, `ScopeKind`, `PermissionCategory`, `ResourceVisibility`, `StorageKind`, `StorageBindingKind`, and the input/context interfaces
- `utils`: reusable helpers such as `buildAccessContext`, `buildArangoContext`, `buildQdrantFilter`, `lowerSlug`, `sameTenant`, `relationMatch`, and the relation policy constants
- `models`: all authorization models, including tenants, org units, users, groups, principals, memberships, roles, permissions, resource grants, effective permissions, and storage bindings
- `services`: the repository-backed service layer for CRUD, hierarchy management, bootstrap, authorization, and policy materialization

The subpath is exported as `@decaf-ts/integrations/namespaces`.

The Nest auth helpers in `@decaf-ts/integrations/nest` also understand namespace scopes and keep them separate from regular roles. Namespace scopes can be supplied via the `namespaces` claim, the `namespace` claim, or a Keycloak role prefixed with `namespace:`.
Use the `namespace(...)` decorator exported by `@decaf-ts/integrations/nest` to attach those scopes to models.

## Basic import

```ts
import {
  AuthzService,
  BootstrapService,
  EffectivePermissionService,
  OrgUnitService,
  ProtectedResourceService,
  ResourceGrantService,
  RoleAssignmentService,
  SystemManagementService,
  TenantService,
  type BootstrapTemplate,
  PermissionCategory,
  ResourceVisibility,
  ScopeKind,
} from "@decaf-ts/integrations/namespaces";
```

## Build the authorization graph

Start with a tenant, then create the org hierarchy, principals, roles, and permissions. Use the bootstrap service when you want the full setup flow in one transactional boundary.

```ts
const bootstrap = new BootstrapService();

const template: BootstrapTemplate = {
  tenant: {
    slug: "acme",
    name: "Acme",
  },
  rootOrgUnit: {
    name: "Root",
  },
  permissions: [
    { key: "resource.read", category: PermissionCategory.ContentRead },
  ],
  roles: [
    {
      key: "owner",
      name: "Owner",
      permissionKeys: ["resource.read"],
    },
  ],
  ownerUser: {
    displayName: "Admin",
    email: "admin@acme.example",
  },
  ownerRoleKey: "owner",
};

const created = await bootstrap.bootstrapTenantFromTemplate(template);
```

If you need finer control, use the individual services:

```ts
const tenants = new TenantService();
const orgUnits = new OrgUnitService();
const assignments = new RoleAssignmentService();

const tenant = await tenants.createTenant({ slug: "acme", name: "Acme" });
const root = await orgUnits.createRoot(tenant.id, "Root");

await assignments.assignRole({
  tenantId: tenant.id,
  principalId: "principal-id",
  roleId: "role-id",
  scopeKind: ScopeKind.OrgUnit,
  scopeId: root.id,
  inheritDown: true,
});
```

## Register resources and grants

Use `ProtectedResourceService` to register objects that need authorization metadata, then add explicit grants when you need a resource-specific exception.

```ts
const resources = new ProtectedResourceService();
const grants = new ResourceGrantService();
const effectivePermissions = new EffectivePermissionService();

const resource = await resources.registerResource({
  tenantId: "tenant-id",
  orgUnitId: "org-unit-id",
  resourceType: "document",
  resourceId: "doc-123",
  visibility: ResourceVisibility.OrgUnit,
});

await grants.grantResource({
  tenantId: "tenant-id",
  resourceId: resource.id,
  principalId: "principal-id",
  permissionKey: "resource.read",
});
```

## Check access at runtime

Use `AuthzService` when you want a repository-agnostic authorization decision. It can answer direct resource checks, scope checks, and payload builders for external data stores.

```ts
const authz = new AuthzService({
  loadResource: async (tenantId, protectedResourceId) =>
    resources.getById(protectedResourceId),
  listResourceGrants: async (tenantId, protectedResourceId) =>
    grants.listResourceGrants(protectedResourceId),
  listPrincipalGrants: async (tenantId, principalId) =>
    grants.listPrincipalGrants(tenantId, principalId),
  listEffectivePermissions: async (tenantId, principalId) =>
    effectivePermissions.listForPrincipal(tenantId, principalId),
  listEffectivePermissionsForScope: async (tenantId, scopeKind, scopeId) =>
    effectivePermissions.listForScope(tenantId, scopeKind, scopeId),
});

const allowed = await authz.canAccess({
  tenantId: "tenant-id",
  principalId: "principal-id",
  permissionKey: "resource.read",
  resourceProtectedId: "protected-resource-id",
});
```

The same service can build authorization payloads for Arango and Qdrant:

```ts
const arangoContext = await authz.buildArangoContext(
  "tenant-id",
  "principal-id",
  "resource.read"
);

const qdrantFilter = await authz.buildQdrantFilter(
  "tenant-id",
  "principal-id",
  "resource.read"
);
```

## RLS requirements

The shipped RLS layer is **generated from source** (`src/namespaces/rls/rls.template.ts` → `sql/002_rls.sql`, "do not edit by hand"): 24 `SECURITY DEFINER` helper functions and 88 `CREATE POLICY` statements protect the 22 tables in `RLS_PROTECTED_TABLES` — the authorization machinery, org profiles, protected resources, and the credential/secret records. Apply it through `RlsBootstrapService.apply()` with a `SUPERUSER` or `BYPASSRLS` executor role; `apply()` fails closed with `RlsFunctionOwnerError` otherwise. Write policies ship with the template — do not hand-add `INSERT`/`UPDATE`/`DELETE` policies in a separate migration layer.

Policies resolve the acting principal from the `app.principal_id` session setting (`RLS_SETTINGS`).

### Binding the request principal

- **Resolve the subject once, at auth-priming time, on a privileged connection.** Call `resolvePrincipalForSubject(client, subject, tenantId?)` from `@decaf-ts/integrations/namespaces` with a privileged auth-prime/service-role client: it maps the authenticated subject to the single matching principal UUID through the `SECURITY DEFINER` helper `app_rls_principal_for_subject(text, uuid)` — fully parameterized SQL, UUID-validated, fail-closed (`undefined` when the subject is empty, ambiguous, or unknown). The helper is `REVOKE`d from `PUBLIC`, so it is not callable from an RLS-restricted application session.
- **Carry the resolved `principalId` on the request context and wire the binding config-only.** Spread `namespaceRlsTypeORMOptions()` from `@decaf-ts/integrations/namespaces` into the `TypeORMAdapter` options — no subclassing or method overrides. The returned `sessionBinding` is a `namespaceRlsSessionBinding` resolver that reads the `principalId` context key by default; `@decaf-ts/for-typeorm` consumes it transaction-locally: `TypeORMContextLock.begin(context)` issues `SELECT set_config('app.principal_id', $1, true)` right after `BEGIN`, so the setting lives only inside that transaction.
- **Deny-by-default.** A context without a resolvable principal leaves `app.principal_id` unbound and RLS denies the transaction's protected-row reads. An authenticated context that fails to resolve logs a single warning — never the principal value.
- **Transaction-local only.** The binding is discarded at commit/rollback and is never set session-wide on pooled connections. For infrastructure jobs that need a principal outside a request transaction, use `runAsPrincipal(executor, principalId, run, {commit?})` on a dedicated single connection.

```ts
import { TypeORMAdapter } from "@decaf-ts/for-typeorm";
import { namespaceRlsTypeORMOptions } from "@decaf-ts/integrations/namespaces";

const adapter = new TypeORMAdapter({
  ...dataSourceOptions,
  ...namespaceRlsTypeORMOptions(), // binds ctx "principalId" as app.principal_id, transaction-locally
});
```

## How effective permissions are rebuilt

`EffectivePermissionService.rebuildForPrincipal()` materializes permissions from role assignments and group membership, expands org-unit inheritance when `inheritDown = true`, and skips inherited scopes blocked by `InheritanceBlock`.

Use `SystemManagementService` when you want the common lifecycle operations:

- onboard a user into a tenant and org unit
- change an org role
- suspend or reactivate tenant membership

```ts
const system = new SystemManagementService();

await system.onboardUserToTenantAndOrgUnit(
  "tenant-id",
  "user-id",
  "org-unit-id",
  "owner"
);
```

## Keycloak namespace claims

The Keycloak helper exports in `@decaf-ts/integrations/nest` normalize namespace scopes so they can be reused by the auth system and UI guards:

- `extractKeycloakNamespaces()` collects namespaces from `namespaces`, `namespace`, and `namespace:`-prefixed roles.
- `extractKeycloakRoles()` keeps regular roles only.
- `KeycloakAuthHandler` binds both `roles` and `namespaces` onto the request context.

## How to extend the namespace

To add a new authorization concept, follow the existing pattern:

1. Add the model in `src/namespaces/models/` and export it from `src/namespaces/models/index.ts`.
2. Add the service in `src/namespaces/services/` and export it from `src/namespaces/services/index.ts`.
3. Extend `types.ts` if the feature needs new enums or DTOs.
4. Add helper functions to `utils.ts` only when the logic is shared across services.
5. Add or update SQL migrations when the feature needs constraints, indexes, or RLS.
6. Add targeted unit tests in `tests/unit/namespaces/` and integration tests when the flow depends on live persistence.

Use `BaseModelService` as the default service base. Keep domain-specific logic in services, not in the models.

## Implementation notes

- `OrgUnitService` owns org tree creation, closure-table rebuilds, moves, and subtree deletion.
- `RoleAssignmentService` owns scope-bound role grants and revocation.
- `ResourceLifecycleService` deletes resource grants before deleting the protected resource row.
- `StorageBindingService` records which storage backend a tenant is using.
- `AuthzService` should be fed by repository-backed data sources or live persistence adapters, never by hard-coded fixtures in production code.
