ALTER TABLE protected_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE protected_resources FORCE ROW LEVEL SECURITY;

CREATE POLICY protected_resources_select_policy
ON protected_resources
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM effective_permissions ep
    WHERE ep.tenant_id = protected_resources.tenant_id
      AND ep.principal_id = current_setting('app.principal_id')::uuid
      AND ep.permission_key = 'resource.read'
      AND (
        (ep.scope_kind = 'tenant' AND ep.scope_id = protected_resources.tenant_id)
        OR (ep.scope_kind = 'org_unit' AND ep.scope_id = protected_resources.org_unit_id)
        OR (ep.scope_kind = 'resource' AND ep.scope_id = protected_resources.id)
      )
  )
);
