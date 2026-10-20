-- Canonical snake_case namespace schema used by the Postgres RLS integration test.
-- Mirrors the table/column names targeted by sql/002_rls.sql and the models in
-- src/namespaces/models (column names follow the SQL artifacts contract).

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  isolation_tier text NOT NULL DEFAULT 'pooled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  parent_id uuid,
  name text NOT NULL,
  path text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_unit_closure (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ancestor_org_unit_id uuid NOT NULL,
  descendant_org_unit_id uuid NOT NULL,
  depth integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  phone text UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  org_unit_id uuid,
  name text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  subject_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_unit_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  org_unit_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  category text NOT NULL,
  description text
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  id uuid PRIMARY KEY,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  inherit_down boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  expires_at timestamptz,
  conditions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inheritance_blocks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  org_unit_id uuid NOT NULL,
  blocked_from_ancestor_id uuid,
  permission_category text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE protected_resources (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  org_unit_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  visibility text NOT NULL,
  owner_principal_id uuid,
  sensitivity text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resource_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  permission_key text NOT NULL,
  starts_at timestamptz,
  expires_at timestamptz,
  conditions jsonb,
  created_by_principal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE effective_permissions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  permission_key text NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE storage_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  storage_kind text NOT NULL,
  binding_kind text NOT NULL,
  binding_key text NOT NULL,
  region text NOT NULL,
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  profile_key text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_unit_profiles (
  id uuid PRIMARY KEY,
  org_unit_id uuid NOT NULL,
  profile_key text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credentials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  org_unit_id uuid,
  owner_principal_id uuid,
  name text NOT NULL,
  credential_type text NOT NULL,
  secret_name text NOT NULL,
  provider text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE secrets (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  provider text NOT NULL,
  encrypted_payload text NOT NULL,
  encryption jsonb NOT NULL,
  content_type text,
  tags jsonb,
  enabled boolean NOT NULL DEFAULT true,
  version text,
  external_id text,
  uri text,
  tenant_id uuid,
  org_unit_id uuid,
  owner_principal_id uuid
);
