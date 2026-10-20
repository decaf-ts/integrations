/**
 * @module integrations/namespaces/rls/template
 * @summary SQL template for the namespace row-level-security policies.
 * @description Generates the helper functions and enable/force/policy DDL that
 * enforce the reader/writer/admin matrix across the namespace tables and the
 * slice-1 credential/secret records.
 *
 * The template assumes the canonical snake_case schema documented by the
 * `integrations/sql` artifacts. Helper functions are `SECURITY DEFINER` so the
 * authorization lookups bypass RLS and cannot recurse through the policies they
 * implement. Production deployments should own those functions with a role that
 * is allowed to bypass RLS (the database owner, a `BYPASSRLS` role, or the
 * migration role).
 */
import { InternalError } from "@decaf-ts/db-decorators";
import type { RlsPolicySet } from "./rls.types";
import { RLS_PROTECTED_TABLES } from "./rls.constants";

const FUNCTION_SEARCH_PATH = "SET search_path = public, pg_temp";

/**
 * @description Helper functions backing the namespace RLS policies.
 * @summary Each function is idempotently created with `CREATE OR REPLACE`.
 */
export const RLS_FUNCTION_STATEMENTS: readonly string[] = [
  `CREATE OR REPLACE FUNCTION app_rls_principal_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT NULLIF(current_setting('app.principal_id', true), '')::uuid
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_subject_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT p.subject_id
  FROM principals p
  WHERE p.id = app_rls_principal_id()
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_principal_for_subject(
  p_subject text,
  p_tenant uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT CASE WHEN COUNT(*) = 1 THEN (MIN(p.id::text))::uuid ELSE NULL END
  FROM principals p
  WHERE p.subject_id = NULLIF(p_subject, '')
    AND (p_tenant IS NULL OR p.tenant_id = p_tenant)
$fn$;`,
  `REVOKE ALL ON FUNCTION app_rls_principal_for_subject(text, uuid) FROM PUBLIC;`,
  `CREATE OR REPLACE FUNCTION app_rls_org_unit_tenant(p_org_unit uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT ou.tenant_id
  FROM org_units ou
  WHERE ou.id = p_org_unit
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_has_permission(
  p_tenant uuid,
  p_permission text,
  p_scope_kind text,
  p_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM effective_permissions ep
    WHERE ep.tenant_id = p_tenant
      AND ep.principal_id = app_rls_principal_id()
      AND ep.permission_key = p_permission
      AND ep.scope_kind = p_scope_kind
      AND ep.scope_id = p_scope_id
      AND (ep.starts_at IS NULL OR ep.starts_at <= now())
      AND (ep.expires_at IS NULL OR ep.expires_at >= now())
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_tenant_permission(
  p_tenant uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_has_permission(
    p_tenant,
    p_permission,
    'tenant',
    p_tenant::text
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_org_unit_permission(
  p_tenant uuid,
  p_org_unit uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_has_permission(
    p_tenant,
    p_permission,
    'tenant',
    p_tenant::text
  )
  OR (
    p_org_unit IS NOT NULL
    AND app_rls_has_permission(
      p_tenant,
      p_permission,
      'org_unit',
      p_org_unit::text
    )
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_tenant_member(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    WHERE tm.tenant_id = p_tenant
      AND tm.status = 'active'
      AND tm.user_id::text = app_rls_subject_id()
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_org_unit_member(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM org_unit_memberships m
    WHERE m.tenant_id = p_tenant
      AND m.org_unit_id = p_org_unit
      AND m.status = 'active'
      AND m.user_id::text = app_rls_subject_id()
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_read_tenant(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_tenant_permission(p_tenant, 'namespace.admin')
  OR app_rls_tenant_permission(p_tenant, 'namespace.write')
  OR app_rls_tenant_permission(p_tenant, 'namespace.read')
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_write_tenant(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_tenant_permission(p_tenant, 'namespace.admin')
  OR app_rls_tenant_permission(p_tenant, 'namespace.write')
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_read_org_unit(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_can_read_tenant(p_tenant)
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.admin')
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.write')
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.read')
  OR app_rls_is_org_unit_member(p_tenant, p_org_unit)
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_write_org_unit(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_can_write_tenant(p_tenant)
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.admin')
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.write')
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM effective_permissions ep
    WHERE ep.principal_id = app_rls_principal_id()
      AND ep.permission_key = 'namespace.admin'
      AND (ep.starts_at IS NULL OR ep.starts_at <= now())
      AND (ep.expires_at IS NULL OR ep.expires_at >= now())
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_tenant_admin(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_tenant_permission(p_tenant, 'namespace.admin')
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_org_unit_admin(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT app_rls_is_tenant_admin(p_tenant)
  OR (
    p_org_unit IS NOT NULL
    AND app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.admin')
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_scope_admin(
  p_tenant uuid,
  p_scope_kind text,
  p_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT CASE
    WHEN p_scope_kind = 'tenant' THEN app_rls_is_tenant_admin(p_tenant)
    WHEN p_scope_kind = 'org_unit' THEN app_rls_is_org_unit_admin(
      p_tenant,
      p_scope_id::uuid
    )
    WHEN p_scope_kind = 'resource' THEN EXISTS (
      SELECT 1
      FROM protected_resources r
      WHERE r.id = p_scope_id::uuid
        AND r.tenant_id = p_tenant
        AND app_rls_is_org_unit_admin(p_tenant, r.org_unit_id)
    )
    ELSE false
  END
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    WHERE tm.user_id = p_user_id
      AND app_rls_is_tenant_admin(tm.tenant_id)
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_read_group(
  p_tenant uuid,
  p_group uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM groups g
    WHERE g.id = p_group
      AND g.tenant_id = p_tenant
      AND (
        (g.org_unit_id IS NULL AND app_rls_can_read_tenant(p_tenant))
        OR (
          g.org_unit_id IS NOT NULL
          AND app_rls_can_read_org_unit(p_tenant, g.org_unit_id)
        )
      )
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_write_group(
  p_tenant uuid,
  p_group uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM groups g
    WHERE g.id = p_group
      AND g.tenant_id = p_tenant
      AND (
        (g.org_unit_id IS NULL AND app_rls_can_write_tenant(p_tenant))
        OR (
          g.org_unit_id IS NOT NULL
          AND app_rls_can_write_org_unit(p_tenant, g.org_unit_id)
        )
      )
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_read_resource(
  p_tenant uuid,
  p_resource uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM protected_resources r
    WHERE r.id = p_resource
      AND r.tenant_id = p_tenant
      AND (
        r.owner_principal_id = app_rls_principal_id()
        OR app_rls_is_org_unit_admin(p_tenant, r.org_unit_id)
        OR (
          r.visibility = 'tenant'
          AND app_rls_can_read_tenant(p_tenant)
        )
        OR (
          r.visibility IN ('org_unit', 'org_subtree')
          AND app_rls_can_read_org_unit(p_tenant, r.org_unit_id)
        )
        OR EXISTS (
          SELECT 1
          FROM resource_grants g
          WHERE g.resource_id = r.id
            AND g.principal_id = app_rls_principal_id()
            AND g.permission_key IN (
              'resource.read',
              'namespace.read',
              'namespace.write',
              'namespace.admin'
            )
            AND (g.starts_at IS NULL OR g.starts_at <= now())
            AND (g.expires_at IS NULL OR g.expires_at >= now())
        )
      )
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_write_resource(
  p_tenant uuid,
  p_resource uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM protected_resources r
    WHERE r.id = p_resource
      AND r.tenant_id = p_tenant
      AND (
        app_rls_is_org_unit_admin(p_tenant, r.org_unit_id)
        OR app_rls_can_write_org_unit(p_tenant, r.org_unit_id)
      )
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_is_role_admin(p_role uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM roles r
    WHERE r.id = p_role
      AND (
        (r.tenant_id IS NULL AND app_rls_is_admin())
        OR (
          r.tenant_id IS NOT NULL
          AND app_rls_is_tenant_admin(r.tenant_id)
        )
      )
  )
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_read_credential_scope(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT CASE
    WHEN p_org_unit IS NULL THEN app_rls_can_read_tenant(p_tenant)
    ELSE app_rls_can_read_org_unit(p_tenant, p_org_unit)
  END
$fn$;`,
  `CREATE OR REPLACE FUNCTION app_rls_can_write_credential_scope(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
${FUNCTION_SEARCH_PATH}
AS $fn$
  SELECT CASE
    WHEN p_org_unit IS NULL THEN app_rls_can_write_tenant(p_tenant)
    ELSE app_rls_can_write_org_unit(p_tenant, p_org_unit)
  END
$fn$;`,
];

const ADMIN = "app_rls_is_admin()";
const TENANT_ADMIN = "app_rls_is_tenant_admin(tenant_id)";
const WRITE_SCOPE = "app_rls_can_write_org_unit(tenant_id, org_unit_id)";
const CREDENTIAL_READ =
  "app_rls_can_read_credential_scope(tenant_id, org_unit_id)";
const CREDENTIAL_WRITE =
  "app_rls_can_write_credential_scope(tenant_id, org_unit_id)";

/**
 * @description Canonical reader/writer/admin policy matrix.
 * @summary Administrative tables (permissions, roles, role assignments,
 * inheritance blocks, storage bindings) are visible only to admins. Content
 * tables are visible to readers and writable by writers. Users always see their
 * own identity rows and their own credentials/secrets.
 */
export const NAMESPACE_RLS_POLICY_SETS: readonly RlsPolicySet[] = [
  {
    table: "tenants",
    select: "app_rls_is_tenant_member(id) OR app_rls_can_read_tenant(id)",
    insert: ADMIN,
    update: "app_rls_is_tenant_admin(id)",
    delete: "app_rls_is_tenant_admin(id)",
  },
  {
    table: "org_units",
    select:
      "app_rls_can_read_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id))",
    insert:
      "app_rls_can_write_tenant(tenant_id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id))",
    update:
      "app_rls_can_write_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id))",
    delete:
      "app_rls_can_write_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id))",
  },
  {
    table: "org_unit_closure",
    select:
      "app_rls_can_read_org_unit(tenant_id, descendant_org_unit_id)",
    insert:
      "app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id)",
    update:
      "app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id)",
    delete:
      "app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id)",
  },
  {
    table: "users",
    select:
      "id::text = app_rls_subject_id() OR app_rls_can_admin_user(id)",
    insert: ADMIN,
    update:
      "id::text = app_rls_subject_id() OR app_rls_can_admin_user(id)",
    delete: "app_rls_can_admin_user(id)",
  },
  {
    table: "groups",
    select: "app_rls_can_read_group(tenant_id, id)",
    insert:
      "app_rls_can_write_tenant(tenant_id) OR (org_unit_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, org_unit_id))",
    update: "app_rls_can_write_group(tenant_id, id)",
    delete: "app_rls_can_write_group(tenant_id, id)",
  },
  {
    table: "principals",
    select:
      "id = app_rls_principal_id() OR (kind = 'user' AND subject_id = app_rls_subject_id()) OR app_rls_is_tenant_admin(tenant_id)",
    insert: TENANT_ADMIN,
    update: TENANT_ADMIN,
    delete: TENANT_ADMIN,
  },
  {
    table: "tenant_memberships",
    select:
      "user_id::text = app_rls_subject_id() OR app_rls_can_read_tenant(tenant_id)",
    insert: TENANT_ADMIN,
    update: TENANT_ADMIN,
    delete: TENANT_ADMIN,
  },
  {
    table: "org_unit_memberships",
    select:
      "user_id::text = app_rls_subject_id() OR app_rls_org_unit_permission(tenant_id, org_unit_id, 'namespace.admin') OR app_rls_org_unit_permission(tenant_id, org_unit_id, 'namespace.write') OR app_rls_org_unit_permission(tenant_id, org_unit_id, 'namespace.read')",
    insert: WRITE_SCOPE,
    update: WRITE_SCOPE,
    delete: WRITE_SCOPE,
  },
  {
    table: "group_memberships",
    select: "app_rls_can_read_group(tenant_id, group_id)",
    insert: "app_rls_can_write_group(tenant_id, group_id)",
    update: "app_rls_can_write_group(tenant_id, group_id)",
    delete: "app_rls_can_write_group(tenant_id, group_id)",
  },
  {
    table: "permissions",
    select: ADMIN,
    insert: ADMIN,
    update: ADMIN,
    delete: ADMIN,
  },
  {
    table: "roles",
    select:
      "(tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin())",
    insert:
      "(tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin())",
    update:
      "(tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin())",
    delete:
      "(tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin())",
  },
  {
    table: "role_permissions",
    select: "app_rls_is_role_admin(role_id)",
    insert: "app_rls_is_role_admin(role_id)",
    update: "app_rls_is_role_admin(role_id)",
    delete: "app_rls_is_role_admin(role_id)",
  },
  {
    table: "role_assignments",
    select: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
    insert: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
    update: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
    delete: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
  },
  {
    table: "inheritance_blocks",
    select: "app_rls_is_org_unit_admin(tenant_id, org_unit_id)",
    insert: "app_rls_is_org_unit_admin(tenant_id, org_unit_id)",
    update: "app_rls_is_org_unit_admin(tenant_id, org_unit_id)",
    delete: "app_rls_is_org_unit_admin(tenant_id, org_unit_id)",
  },
  {
    table: "protected_resources",
    select: "app_rls_can_read_resource(tenant_id, id)",
    insert:
      "app_rls_can_write_tenant(tenant_id) OR (org_unit_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, org_unit_id))",
    update: "app_rls_can_write_resource(tenant_id, id)",
    delete: "app_rls_can_write_resource(tenant_id, id)",
  },
  {
    table: "resource_grants",
    select:
      "principal_id = app_rls_principal_id() OR app_rls_can_read_resource(tenant_id, resource_id)",
    insert: "app_rls_can_write_resource(tenant_id, resource_id)",
    update: "app_rls_can_write_resource(tenant_id, resource_id)",
    delete: "app_rls_can_write_resource(tenant_id, resource_id)",
  },
  {
    table: "effective_permissions",
    select:
      "principal_id = app_rls_principal_id() OR app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
    insert: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
    update: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
    delete: "app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)",
  },
  {
    table: "storage_bindings",
    select: TENANT_ADMIN,
    insert: TENANT_ADMIN,
    update: TENANT_ADMIN,
    delete: TENANT_ADMIN,
  },
  {
    table: "tenant_profiles",
    select:
      "app_rls_is_tenant_member(tenant_id) OR app_rls_can_read_tenant(tenant_id)",
    insert: TENANT_ADMIN,
    update: TENANT_ADMIN,
    delete: TENANT_ADMIN,
  },
  {
    table: "org_unit_profiles",
    select:
      "app_rls_can_read_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id)",
    insert:
      "app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id)",
    update:
      "app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id)",
    delete:
      "app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id)",
  },
  {
    table: "credentials",
    select:
      "owner_principal_id = app_rls_principal_id() OR " + CREDENTIAL_READ,
    insert: CREDENTIAL_WRITE,
    update: CREDENTIAL_WRITE,
    delete: CREDENTIAL_WRITE,
  },
  {
    table: "secrets",
    select:
      "owner_principal_id = app_rls_principal_id() OR " +
      CREDENTIAL_READ +
      " OR (tenant_id IS NULL AND app_rls_is_admin())",
    insert:
      CREDENTIAL_WRITE + " OR (tenant_id IS NULL AND app_rls_is_admin())",
    update:
      CREDENTIAL_WRITE + " OR (tenant_id IS NULL AND app_rls_is_admin())",
    delete:
      CREDENTIAL_WRITE + " OR (tenant_id IS NULL AND app_rls_is_admin())",
  },
];

/**
 * @description Generates enable/force and policy DDL for a policy set.
 * @summary `DROP POLICY IF EXISTS` makes the output safe to replay on every
 * deployment. Missing command expressions leave that command denied.
 */
export function rlsPolicyStatements(
  policySets: readonly RlsPolicySet[] = NAMESPACE_RLS_POLICY_SETS
): string[] {
  const statements: string[] = [];
  for (const set of policySets) {
    if (set.enable !== false) {
      statements.push(
        `ALTER TABLE ${set.table} ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE ${set.table} FORCE ROW LEVEL SECURITY;`
      );
    }
    const prefix = set.table.replace(/[^A-Za-z0-9_]/g, "_");
    const commands: Array<
      [string, string | undefined, (name: string, expression: string) => string]
    > = [
      [
        "select",
        set.select,
        (name, expression) =>
          `CREATE POLICY ${name} ON ${set.table} FOR SELECT USING (${expression});`,
      ],
      [
        "insert",
        set.insert,
        (name, expression) =>
          `CREATE POLICY ${name} ON ${set.table} FOR INSERT WITH CHECK (${expression});`,
      ],
      [
        "update",
        set.update,
        (name, expression) =>
          `CREATE POLICY ${name} ON ${set.table} FOR UPDATE USING (${expression}) WITH CHECK (${expression});`,
      ],
      [
        "delete",
        set.delete,
        (name, expression) =>
          `CREATE POLICY ${name} ON ${set.table} FOR DELETE USING (${expression});`,
      ],
    ];
    for (const [command, expression, render] of commands) {
      if (!expression) continue;
      const name = `${prefix}_${command}_policy`;
      statements.push(`DROP POLICY IF EXISTS ${name} ON ${set.table};`, render(
        name,
        expression
      ));
    }
  }
  return statements;
}

/**
 * @description Full namespace RLS bootstrap statement list.
 * @summary Helper functions followed by enable/force and policy DDL for every
 * table in {@link RLS_PROTECTED_TABLES}. Apply after the namespace schema
 * exists and before request-scoped traffic reaches the database.
 */
export function rlsBootstrapStatements(): string[] {
  return [...RLS_FUNCTION_STATEMENTS, ...rlsPolicyStatements()];
}

/**
 * @description Tables targeted by the bundled namespace template.
 */
export function rlsPolicyTables(
  policySets: readonly RlsPolicySet[] = NAMESPACE_RLS_POLICY_SETS
): string[] {
  return policySets.map((set) => set.table);
}

/**
 * @description Asserts that the bundled policy template covers every protected
 * table. Exposed for deployment checks and unit tests.
 */
export function assertRlsTableCoverage(
  policySets: readonly RlsPolicySet[] = NAMESPACE_RLS_POLICY_SETS
): void {
  const covered = new Set(rlsPolicyTables(policySets));
  const missing = RLS_PROTECTED_TABLES.filter((table) => !covered.has(table));
  if (missing.length) {
    throw new InternalError(
      `RLS template is missing tables: ${missing.join(", ")}`
    );
  }
}
