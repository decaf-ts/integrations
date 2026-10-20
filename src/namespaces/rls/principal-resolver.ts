import { ValidationError } from "@decaf-ts/db-decorators";

export interface PrincipalSubjectQueryClient {
  query(sql: string, values?: any[]): Promise<unknown>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePrincipalForSubject(
  client: PrincipalSubjectQueryClient,
  subject: string,
  tenantId?: string
): Promise<string | undefined> {
  if (!client || typeof client.query !== "function")
    throw new ValidationError(
      "resolvePrincipalForSubject requires a privileged auth-prime/service-role client, not the application session"
    );
  const normalizedSubject = typeof subject === "string" ? subject.trim() : "";
  if (!normalizedSubject) return undefined;
  if (tenantId !== undefined && tenantId !== null) {
    if (typeof tenantId !== "string" || !UUID_PATTERN.test(tenantId))
      throw new ValidationError(
        "resolvePrincipalForSubject tenantId must be a UUID when provided"
      );
  }
  const result = (await client.query(
    "SELECT app_rls_principal_for_subject($1, $2) AS principal_id",
    [normalizedSubject, tenantId ?? null]
  )) as any;
  const rows = Array.isArray(result) ? result : result?.rows;
  const principalId = Array.isArray(rows) ? rows[0]?.principal_id : undefined;
  if (typeof principalId !== "string") return undefined;
  const normalized = principalId.trim();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}
