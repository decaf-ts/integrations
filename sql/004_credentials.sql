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

-- Fail-closed guard for the (name, version) uniqueness migration.
-- Lists every secrets row group that shares a (name, coalesce(version, ''))
-- key and aborts the migration with an exception so legacy duplicates are
-- resolved explicitly before the unique index below can be created.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(format('%s (version=%s) x%s', name, version, total), ', ')
  INTO duplicates
  FROM (
    SELECT name, coalesce(version, '') AS version, count(*) AS total
    FROM secrets
    GROUP BY name, coalesce(version, '')
    HAVING count(*) > 1
  ) AS duplicated;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce secrets (name, version) uniqueness: duplicate rows exist for %. Resolve those rows before applying sql/004_credentials.sql.',
      duplicates;
  END IF;
END
$$;

-- Replaces the non-unique ix_secrets_name with a unique index on
-- (name, coalesce(version, '')): versions are optional, so NULL versions
-- collapse to '' and one default row per name is enforced alongside
-- explicitly versioned rows.
DROP INDEX IF EXISTS ix_secrets_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_secrets_name_version ON secrets (name, coalesce(version, ''));
