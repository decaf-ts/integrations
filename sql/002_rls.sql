-- Namespace row-level security template.
-- Generated from src/namespaces/rls/rls.template.ts; do not edit by hand.
-- Apply with RlsBootstrapService.apply() or a migration runner.
CREATE OR REPLACE FUNCTION app_rls_principal_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT NULLIF(current_setting('app.principal_id', true), '')::uuid
$fn$;
CREATE OR REPLACE FUNCTION app_rls_subject_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.subject_id
  FROM principals p
  WHERE p.id = app_rls_principal_id()
$fn$;
CREATE OR REPLACE FUNCTION app_rls_org_unit_tenant(p_org_unit uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT ou.tenant_id
  FROM org_units ou
  WHERE ou.id = p_org_unit
$fn$;
CREATE OR REPLACE FUNCTION app_rls_has_permission(
  p_tenant uuid,
  p_permission text,
  p_scope_kind text,
  p_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_tenant_permission(
  p_tenant uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_has_permission(
    p_tenant,
    p_permission,
    'tenant',
    p_tenant::text
  )
$fn$;
CREATE OR REPLACE FUNCTION app_rls_org_unit_permission(
  p_tenant uuid,
  p_org_unit uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_tenant_member(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    WHERE tm.tenant_id = p_tenant
      AND tm.status = 'active'
      AND tm.user_id::text = app_rls_subject_id()
  )
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_org_unit_member(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM org_unit_memberships m
    WHERE m.tenant_id = p_tenant
      AND m.org_unit_id = p_org_unit
      AND m.status = 'active'
      AND m.user_id::text = app_rls_subject_id()
  )
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_read_tenant(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_tenant_permission(p_tenant, 'namespace.admin')
  OR app_rls_tenant_permission(p_tenant, 'namespace.write')
  OR app_rls_tenant_permission(p_tenant, 'namespace.read')
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_write_tenant(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_tenant_permission(p_tenant, 'namespace.admin')
  OR app_rls_tenant_permission(p_tenant, 'namespace.write')
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_read_org_unit(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_can_read_tenant(p_tenant)
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.admin')
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.write')
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.read')
  OR app_rls_is_org_unit_member(p_tenant, p_org_unit)
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_write_org_unit(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_can_write_tenant(p_tenant)
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.admin')
  OR app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.write')
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM effective_permissions ep
    WHERE ep.principal_id = app_rls_principal_id()
      AND ep.permission_key = 'namespace.admin'
      AND (ep.starts_at IS NULL OR ep.starts_at <= now())
      AND (ep.expires_at IS NULL OR ep.expires_at >= now())
  )
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_tenant_admin(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_tenant_permission(p_tenant, 'namespace.admin')
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_org_unit_admin(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT app_rls_is_tenant_admin(p_tenant)
  OR (
    p_org_unit IS NOT NULL
    AND app_rls_org_unit_permission(p_tenant, p_org_unit, 'namespace.admin')
  )
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_scope_admin(
  p_tenant uuid,
  p_scope_kind text,
  p_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    WHERE tm.user_id = p_user_id
      AND app_rls_is_tenant_admin(tm.tenant_id)
  )
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_read_group(
  p_tenant uuid,
  p_group uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_write_group(
  p_tenant uuid,
  p_group uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_read_resource(
  p_tenant uuid,
  p_resource uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_write_resource(
  p_tenant uuid,
  p_resource uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_is_role_admin(p_role uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_read_credential_scope(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_org_unit IS NULL THEN app_rls_can_read_tenant(p_tenant)
    ELSE app_rls_can_read_org_unit(p_tenant, p_org_unit)
  END
$fn$;
CREATE OR REPLACE FUNCTION app_rls_can_write_credential_scope(
  p_tenant uuid,
  p_org_unit uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_org_unit IS NULL THEN app_rls_can_write_tenant(p_tenant)
    ELSE app_rls_can_write_org_unit(p_tenant, p_org_unit)
  END
$fn$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_select_policy ON tenants;
CREATE POLICY tenants_select_policy ON tenants FOR SELECT USING (app_rls_is_tenant_member(id) OR app_rls_can_read_tenant(id));
DROP POLICY IF EXISTS tenants_insert_policy ON tenants;
CREATE POLICY tenants_insert_policy ON tenants FOR INSERT WITH CHECK (app_rls_is_admin());
DROP POLICY IF EXISTS tenants_update_policy ON tenants;
CREATE POLICY tenants_update_policy ON tenants FOR UPDATE USING (app_rls_is_tenant_admin(id)) WITH CHECK (app_rls_is_tenant_admin(id));
DROP POLICY IF EXISTS tenants_delete_policy ON tenants;
CREATE POLICY tenants_delete_policy ON tenants FOR DELETE USING (app_rls_is_tenant_admin(id));
ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_units_select_policy ON org_units;
CREATE POLICY org_units_select_policy ON org_units FOR SELECT USING (app_rls_can_read_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id)));
DROP POLICY IF EXISTS org_units_insert_policy ON org_units;
CREATE POLICY org_units_insert_policy ON org_units FOR INSERT WITH CHECK (app_rls_can_write_tenant(tenant_id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id)));
DROP POLICY IF EXISTS org_units_update_policy ON org_units;
CREATE POLICY org_units_update_policy ON org_units FOR UPDATE USING (app_rls_can_write_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id))) WITH CHECK (app_rls_can_write_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id)));
DROP POLICY IF EXISTS org_units_delete_policy ON org_units;
CREATE POLICY org_units_delete_policy ON org_units FOR DELETE USING (app_rls_can_write_org_unit(tenant_id, id) OR (parent_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, parent_id)));
ALTER TABLE org_unit_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit_closure FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_unit_closure_select_policy ON org_unit_closure;
CREATE POLICY org_unit_closure_select_policy ON org_unit_closure FOR SELECT USING (app_rls_can_read_org_unit(tenant_id, descendant_org_unit_id));
DROP POLICY IF EXISTS org_unit_closure_insert_policy ON org_unit_closure;
CREATE POLICY org_unit_closure_insert_policy ON org_unit_closure FOR INSERT WITH CHECK (app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id));
DROP POLICY IF EXISTS org_unit_closure_update_policy ON org_unit_closure;
CREATE POLICY org_unit_closure_update_policy ON org_unit_closure FOR UPDATE USING (app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id)) WITH CHECK (app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id));
DROP POLICY IF EXISTS org_unit_closure_delete_policy ON org_unit_closure;
CREATE POLICY org_unit_closure_delete_policy ON org_unit_closure FOR DELETE USING (app_rls_can_write_org_unit(tenant_id, descendant_org_unit_id));
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_policy ON users;
CREATE POLICY users_select_policy ON users FOR SELECT USING (id::text = app_rls_subject_id() OR app_rls_can_admin_user(id));
DROP POLICY IF EXISTS users_insert_policy ON users;
CREATE POLICY users_insert_policy ON users FOR INSERT WITH CHECK (app_rls_is_admin());
DROP POLICY IF EXISTS users_update_policy ON users;
CREATE POLICY users_update_policy ON users FOR UPDATE USING (id::text = app_rls_subject_id() OR app_rls_can_admin_user(id)) WITH CHECK (id::text = app_rls_subject_id() OR app_rls_can_admin_user(id));
DROP POLICY IF EXISTS users_delete_policy ON users;
CREATE POLICY users_delete_policy ON users FOR DELETE USING (app_rls_can_admin_user(id));
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS groups_select_policy ON groups;
CREATE POLICY groups_select_policy ON groups FOR SELECT USING (app_rls_can_read_group(tenant_id, id));
DROP POLICY IF EXISTS groups_insert_policy ON groups;
CREATE POLICY groups_insert_policy ON groups FOR INSERT WITH CHECK (app_rls_can_write_tenant(tenant_id) OR (org_unit_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, org_unit_id)));
DROP POLICY IF EXISTS groups_update_policy ON groups;
CREATE POLICY groups_update_policy ON groups FOR UPDATE USING (app_rls_can_write_group(tenant_id, id)) WITH CHECK (app_rls_can_write_group(tenant_id, id));
DROP POLICY IF EXISTS groups_delete_policy ON groups;
CREATE POLICY groups_delete_policy ON groups FOR DELETE USING (app_rls_can_write_group(tenant_id, id));
ALTER TABLE principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS principals_select_policy ON principals;
CREATE POLICY principals_select_policy ON principals FOR SELECT USING (id = app_rls_principal_id() OR (kind = 'user' AND subject_id = app_rls_subject_id()) OR app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS principals_insert_policy ON principals;
CREATE POLICY principals_insert_policy ON principals FOR INSERT WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS principals_update_policy ON principals;
CREATE POLICY principals_update_policy ON principals FOR UPDATE USING (app_rls_is_tenant_admin(tenant_id)) WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS principals_delete_policy ON principals;
CREATE POLICY principals_delete_policy ON principals FOR DELETE USING (app_rls_is_tenant_admin(tenant_id));
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_memberships_select_policy ON tenant_memberships;
CREATE POLICY tenant_memberships_select_policy ON tenant_memberships FOR SELECT USING (user_id::text = app_rls_subject_id() OR app_rls_can_read_tenant(tenant_id));
DROP POLICY IF EXISTS tenant_memberships_insert_policy ON tenant_memberships;
CREATE POLICY tenant_memberships_insert_policy ON tenant_memberships FOR INSERT WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS tenant_memberships_update_policy ON tenant_memberships;
CREATE POLICY tenant_memberships_update_policy ON tenant_memberships FOR UPDATE USING (app_rls_is_tenant_admin(tenant_id)) WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS tenant_memberships_delete_policy ON tenant_memberships;
CREATE POLICY tenant_memberships_delete_policy ON tenant_memberships FOR DELETE USING (app_rls_is_tenant_admin(tenant_id));
ALTER TABLE org_unit_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_unit_memberships_select_policy ON org_unit_memberships;
CREATE POLICY org_unit_memberships_select_policy ON org_unit_memberships FOR SELECT USING (user_id::text = app_rls_subject_id() OR app_rls_org_unit_permission(tenant_id, org_unit_id, 'namespace.admin') OR app_rls_org_unit_permission(tenant_id, org_unit_id, 'namespace.write') OR app_rls_org_unit_permission(tenant_id, org_unit_id, 'namespace.read'));
DROP POLICY IF EXISTS org_unit_memberships_insert_policy ON org_unit_memberships;
CREATE POLICY org_unit_memberships_insert_policy ON org_unit_memberships FOR INSERT WITH CHECK (app_rls_can_write_org_unit(tenant_id, org_unit_id));
DROP POLICY IF EXISTS org_unit_memberships_update_policy ON org_unit_memberships;
CREATE POLICY org_unit_memberships_update_policy ON org_unit_memberships FOR UPDATE USING (app_rls_can_write_org_unit(tenant_id, org_unit_id)) WITH CHECK (app_rls_can_write_org_unit(tenant_id, org_unit_id));
DROP POLICY IF EXISTS org_unit_memberships_delete_policy ON org_unit_memberships;
CREATE POLICY org_unit_memberships_delete_policy ON org_unit_memberships FOR DELETE USING (app_rls_can_write_org_unit(tenant_id, org_unit_id));
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS group_memberships_select_policy ON group_memberships;
CREATE POLICY group_memberships_select_policy ON group_memberships FOR SELECT USING (app_rls_can_read_group(tenant_id, group_id));
DROP POLICY IF EXISTS group_memberships_insert_policy ON group_memberships;
CREATE POLICY group_memberships_insert_policy ON group_memberships FOR INSERT WITH CHECK (app_rls_can_write_group(tenant_id, group_id));
DROP POLICY IF EXISTS group_memberships_update_policy ON group_memberships;
CREATE POLICY group_memberships_update_policy ON group_memberships FOR UPDATE USING (app_rls_can_write_group(tenant_id, group_id)) WITH CHECK (app_rls_can_write_group(tenant_id, group_id));
DROP POLICY IF EXISTS group_memberships_delete_policy ON group_memberships;
CREATE POLICY group_memberships_delete_policy ON group_memberships FOR DELETE USING (app_rls_can_write_group(tenant_id, group_id));
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_select_policy ON permissions;
CREATE POLICY permissions_select_policy ON permissions FOR SELECT USING (app_rls_is_admin());
DROP POLICY IF EXISTS permissions_insert_policy ON permissions;
CREATE POLICY permissions_insert_policy ON permissions FOR INSERT WITH CHECK (app_rls_is_admin());
DROP POLICY IF EXISTS permissions_update_policy ON permissions;
CREATE POLICY permissions_update_policy ON permissions FOR UPDATE USING (app_rls_is_admin()) WITH CHECK (app_rls_is_admin());
DROP POLICY IF EXISTS permissions_delete_policy ON permissions;
CREATE POLICY permissions_delete_policy ON permissions FOR DELETE USING (app_rls_is_admin());
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_select_policy ON roles;
CREATE POLICY roles_select_policy ON roles FOR SELECT USING ((tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin()));
DROP POLICY IF EXISTS roles_insert_policy ON roles;
CREATE POLICY roles_insert_policy ON roles FOR INSERT WITH CHECK ((tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin()));
DROP POLICY IF EXISTS roles_update_policy ON roles;
CREATE POLICY roles_update_policy ON roles FOR UPDATE USING ((tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin())) WITH CHECK ((tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin()));
DROP POLICY IF EXISTS roles_delete_policy ON roles;
CREATE POLICY roles_delete_policy ON roles FOR DELETE USING ((tenant_id IS NOT NULL AND app_rls_is_tenant_admin(tenant_id)) OR (tenant_id IS NULL AND app_rls_is_admin()));
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_select_policy ON role_permissions;
CREATE POLICY role_permissions_select_policy ON role_permissions FOR SELECT USING (app_rls_is_role_admin(role_id));
DROP POLICY IF EXISTS role_permissions_insert_policy ON role_permissions;
CREATE POLICY role_permissions_insert_policy ON role_permissions FOR INSERT WITH CHECK (app_rls_is_role_admin(role_id));
DROP POLICY IF EXISTS role_permissions_update_policy ON role_permissions;
CREATE POLICY role_permissions_update_policy ON role_permissions FOR UPDATE USING (app_rls_is_role_admin(role_id)) WITH CHECK (app_rls_is_role_admin(role_id));
DROP POLICY IF EXISTS role_permissions_delete_policy ON role_permissions;
CREATE POLICY role_permissions_delete_policy ON role_permissions FOR DELETE USING (app_rls_is_role_admin(role_id));
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_assignments_select_policy ON role_assignments;
CREATE POLICY role_assignments_select_policy ON role_assignments FOR SELECT USING (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
DROP POLICY IF EXISTS role_assignments_insert_policy ON role_assignments;
CREATE POLICY role_assignments_insert_policy ON role_assignments FOR INSERT WITH CHECK (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
DROP POLICY IF EXISTS role_assignments_update_policy ON role_assignments;
CREATE POLICY role_assignments_update_policy ON role_assignments FOR UPDATE USING (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)) WITH CHECK (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
DROP POLICY IF EXISTS role_assignments_delete_policy ON role_assignments;
CREATE POLICY role_assignments_delete_policy ON role_assignments FOR DELETE USING (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
ALTER TABLE inheritance_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inheritance_blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inheritance_blocks_select_policy ON inheritance_blocks;
CREATE POLICY inheritance_blocks_select_policy ON inheritance_blocks FOR SELECT USING (app_rls_is_org_unit_admin(tenant_id, org_unit_id));
DROP POLICY IF EXISTS inheritance_blocks_insert_policy ON inheritance_blocks;
CREATE POLICY inheritance_blocks_insert_policy ON inheritance_blocks FOR INSERT WITH CHECK (app_rls_is_org_unit_admin(tenant_id, org_unit_id));
DROP POLICY IF EXISTS inheritance_blocks_update_policy ON inheritance_blocks;
CREATE POLICY inheritance_blocks_update_policy ON inheritance_blocks FOR UPDATE USING (app_rls_is_org_unit_admin(tenant_id, org_unit_id)) WITH CHECK (app_rls_is_org_unit_admin(tenant_id, org_unit_id));
DROP POLICY IF EXISTS inheritance_blocks_delete_policy ON inheritance_blocks;
CREATE POLICY inheritance_blocks_delete_policy ON inheritance_blocks FOR DELETE USING (app_rls_is_org_unit_admin(tenant_id, org_unit_id));
ALTER TABLE protected_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE protected_resources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protected_resources_select_policy ON protected_resources;
CREATE POLICY protected_resources_select_policy ON protected_resources FOR SELECT USING (app_rls_can_read_resource(tenant_id, id));
DROP POLICY IF EXISTS protected_resources_insert_policy ON protected_resources;
CREATE POLICY protected_resources_insert_policy ON protected_resources FOR INSERT WITH CHECK (app_rls_can_write_tenant(tenant_id) OR (org_unit_id IS NOT NULL AND app_rls_can_write_org_unit(tenant_id, org_unit_id)));
DROP POLICY IF EXISTS protected_resources_update_policy ON protected_resources;
CREATE POLICY protected_resources_update_policy ON protected_resources FOR UPDATE USING (app_rls_can_write_resource(tenant_id, id)) WITH CHECK (app_rls_can_write_resource(tenant_id, id));
DROP POLICY IF EXISTS protected_resources_delete_policy ON protected_resources;
CREATE POLICY protected_resources_delete_policy ON protected_resources FOR DELETE USING (app_rls_can_write_resource(tenant_id, id));
ALTER TABLE resource_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_grants_select_policy ON resource_grants;
CREATE POLICY resource_grants_select_policy ON resource_grants FOR SELECT USING (principal_id = app_rls_principal_id() OR app_rls_can_read_resource(tenant_id, resource_id));
DROP POLICY IF EXISTS resource_grants_insert_policy ON resource_grants;
CREATE POLICY resource_grants_insert_policy ON resource_grants FOR INSERT WITH CHECK (app_rls_can_write_resource(tenant_id, resource_id));
DROP POLICY IF EXISTS resource_grants_update_policy ON resource_grants;
CREATE POLICY resource_grants_update_policy ON resource_grants FOR UPDATE USING (app_rls_can_write_resource(tenant_id, resource_id)) WITH CHECK (app_rls_can_write_resource(tenant_id, resource_id));
DROP POLICY IF EXISTS resource_grants_delete_policy ON resource_grants;
CREATE POLICY resource_grants_delete_policy ON resource_grants FOR DELETE USING (app_rls_can_write_resource(tenant_id, resource_id));
ALTER TABLE effective_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE effective_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS effective_permissions_select_policy ON effective_permissions;
CREATE POLICY effective_permissions_select_policy ON effective_permissions FOR SELECT USING (principal_id = app_rls_principal_id() OR app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
DROP POLICY IF EXISTS effective_permissions_insert_policy ON effective_permissions;
CREATE POLICY effective_permissions_insert_policy ON effective_permissions FOR INSERT WITH CHECK (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
DROP POLICY IF EXISTS effective_permissions_update_policy ON effective_permissions;
CREATE POLICY effective_permissions_update_policy ON effective_permissions FOR UPDATE USING (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id)) WITH CHECK (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
DROP POLICY IF EXISTS effective_permissions_delete_policy ON effective_permissions;
CREATE POLICY effective_permissions_delete_policy ON effective_permissions FOR DELETE USING (app_rls_is_scope_admin(tenant_id, scope_kind, scope_id));
ALTER TABLE storage_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_bindings_select_policy ON storage_bindings;
CREATE POLICY storage_bindings_select_policy ON storage_bindings FOR SELECT USING (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS storage_bindings_insert_policy ON storage_bindings;
CREATE POLICY storage_bindings_insert_policy ON storage_bindings FOR INSERT WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS storage_bindings_update_policy ON storage_bindings;
CREATE POLICY storage_bindings_update_policy ON storage_bindings FOR UPDATE USING (app_rls_is_tenant_admin(tenant_id)) WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS storage_bindings_delete_policy ON storage_bindings;
CREATE POLICY storage_bindings_delete_policy ON storage_bindings FOR DELETE USING (app_rls_is_tenant_admin(tenant_id));
ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_profiles_select_policy ON tenant_profiles;
CREATE POLICY tenant_profiles_select_policy ON tenant_profiles FOR SELECT USING (app_rls_is_tenant_member(tenant_id) OR app_rls_can_read_tenant(tenant_id));
DROP POLICY IF EXISTS tenant_profiles_insert_policy ON tenant_profiles;
CREATE POLICY tenant_profiles_insert_policy ON tenant_profiles FOR INSERT WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS tenant_profiles_update_policy ON tenant_profiles;
CREATE POLICY tenant_profiles_update_policy ON tenant_profiles FOR UPDATE USING (app_rls_is_tenant_admin(tenant_id)) WITH CHECK (app_rls_is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS tenant_profiles_delete_policy ON tenant_profiles;
CREATE POLICY tenant_profiles_delete_policy ON tenant_profiles FOR DELETE USING (app_rls_is_tenant_admin(tenant_id));
ALTER TABLE org_unit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_unit_profiles_select_policy ON org_unit_profiles;
CREATE POLICY org_unit_profiles_select_policy ON org_unit_profiles FOR SELECT USING (app_rls_can_read_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id));
DROP POLICY IF EXISTS org_unit_profiles_insert_policy ON org_unit_profiles;
CREATE POLICY org_unit_profiles_insert_policy ON org_unit_profiles FOR INSERT WITH CHECK (app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id));
DROP POLICY IF EXISTS org_unit_profiles_update_policy ON org_unit_profiles;
CREATE POLICY org_unit_profiles_update_policy ON org_unit_profiles FOR UPDATE USING (app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id)) WITH CHECK (app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id));
DROP POLICY IF EXISTS org_unit_profiles_delete_policy ON org_unit_profiles;
CREATE POLICY org_unit_profiles_delete_policy ON org_unit_profiles FOR DELETE USING (app_rls_can_write_org_unit(app_rls_org_unit_tenant(org_unit_id), org_unit_id));
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credentials_select_policy ON credentials;
CREATE POLICY credentials_select_policy ON credentials FOR SELECT USING (owner_principal_id = app_rls_principal_id() OR app_rls_can_read_credential_scope(tenant_id, org_unit_id));
DROP POLICY IF EXISTS credentials_insert_policy ON credentials;
CREATE POLICY credentials_insert_policy ON credentials FOR INSERT WITH CHECK (app_rls_can_write_credential_scope(tenant_id, org_unit_id));
DROP POLICY IF EXISTS credentials_update_policy ON credentials;
CREATE POLICY credentials_update_policy ON credentials FOR UPDATE USING (app_rls_can_write_credential_scope(tenant_id, org_unit_id)) WITH CHECK (app_rls_can_write_credential_scope(tenant_id, org_unit_id));
DROP POLICY IF EXISTS credentials_delete_policy ON credentials;
CREATE POLICY credentials_delete_policy ON credentials FOR DELETE USING (app_rls_can_write_credential_scope(tenant_id, org_unit_id));
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS secrets_select_policy ON secrets;
CREATE POLICY secrets_select_policy ON secrets FOR SELECT USING (owner_principal_id = app_rls_principal_id() OR app_rls_can_read_credential_scope(tenant_id, org_unit_id) OR (tenant_id IS NULL AND app_rls_is_admin()));
DROP POLICY IF EXISTS secrets_insert_policy ON secrets;
CREATE POLICY secrets_insert_policy ON secrets FOR INSERT WITH CHECK (app_rls_can_write_credential_scope(tenant_id, org_unit_id) OR (tenant_id IS NULL AND app_rls_is_admin()));
DROP POLICY IF EXISTS secrets_update_policy ON secrets;
CREATE POLICY secrets_update_policy ON secrets FOR UPDATE USING (app_rls_can_write_credential_scope(tenant_id, org_unit_id) OR (tenant_id IS NULL AND app_rls_is_admin())) WITH CHECK (app_rls_can_write_credential_scope(tenant_id, org_unit_id) OR (tenant_id IS NULL AND app_rls_is_admin()));
DROP POLICY IF EXISTS secrets_delete_policy ON secrets;
CREATE POLICY secrets_delete_policy ON secrets FOR DELETE USING (app_rls_can_write_credential_scope(tenant_id, org_unit_id) OR (tenant_id IS NULL AND app_rls_is_admin()));
