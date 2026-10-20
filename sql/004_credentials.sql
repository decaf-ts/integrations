-- Namespace columns and indexes for the slice-1 credential/secret models.
-- The RLS policies in sql/002_rls.sql scope both tables by these columns.
ALTER TABLE secrets
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS org_unit_id uuid,
  ADD COLUMN IF NOT EXISTS owner_principal_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_tenant_org_name ON credentials (tenant_id, coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS ix_credentials_owner ON credentials (owner_principal_id);
CREATE INDEX IF NOT EXISTS ix_credentials_secret ON credentials (secret_name);
CREATE INDEX IF NOT EXISTS ix_credentials_tenant_org ON credentials (tenant_id, org_unit_id);

CREATE INDEX IF NOT EXISTS ix_secrets_tenant_org ON secrets (tenant_id, org_unit_id);
CREATE INDEX IF NOT EXISTS ix_secrets_owner ON secrets (owner_principal_id);
CREATE INDEX IF NOT EXISTS ix_secrets_name ON secrets (name);
