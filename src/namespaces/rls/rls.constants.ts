/**
 * @module integrations/namespaces/rls/constants
 * @summary Row-level-security constants for the namespace authorization schema.
 * @description Canonical permission keys, session settings, default role keys, and
 * the tables covered by the namespace RLS template.
 */

/**
 * @description Permission keys consumed by the SQL RLS policies.
 * @summary A namespace reader can only read, a writer can also create/update/delete
 * non-administrative rows, and an admin can do everything in the namespace.
 */
export const RLS_PERMISSION_KEYS = {
  Read: "namespace.read",
  Write: "namespace.write",
  Admin: "namespace.admin",
} as const;

/**
 * @description Session settings read by the RLS policies.
 * @summary The application must set `app.principal_id` for every request-scoped
 * database session or transaction before querying namespace tables.
 */
export const RLS_SETTINGS = {
  Principal: "app.principal_id",
  Tenant: "app.tenant_id",
} as const;

/**
 * @description Default role keys for the reader/writer/admin matrix.
 * @summary Bootstrapping a tenant with these keys gives consumers a stable
 * three-tier namespace role model without coupling them to custom role names.
 */
export const RLS_ROLE_KEYS = {
  Reader: "namespace-reader",
  Writer: "namespace-writer",
  Admin: "namespace-admin",
} as const;

/**
 * @description Tables protected by the namespace RLS template.
 * @summary Includes the authorization machinery, org profiles, protected
 * resources, and the slice-1 credential/secret records.
 */
export const RLS_PROTECTED_TABLES = [
  "tenants",
  "org_units",
  "org_unit_closure",
  "users",
  "groups",
  "principals",
  "tenant_memberships",
  "org_unit_memberships",
  "group_memberships",
  "permissions",
  "roles",
  "role_permissions",
  "role_assignments",
  "inheritance_blocks",
  "protected_resources",
  "resource_grants",
  "effective_permissions",
  "storage_bindings",
  "tenant_profiles",
  "org_unit_profiles",
  "credentials",
  "secrets",
] as const;

export type RlsProtectedTable = (typeof RLS_PROTECTED_TABLES)[number];
