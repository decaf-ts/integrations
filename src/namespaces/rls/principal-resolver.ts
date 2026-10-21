/**
 * @module integrations/namespaces/rls/principal-resolver
 * @summary Resolves a decaf `principals.id` UUID from an authenticated subject through the RLS `SECURITY DEFINER` helper.
 * @description Exposes {@link resolvePrincipalForSubject}, a fail-closed,
 * fully parameterized lookup that maps an authenticated subject id (and
 * optional tenant) to the single matching principal UUID via the
 * `app_rls_principal_for_subject(text, uuid)` SQL helper installed by the
 * namespace RLS template. Intended for privileged infrastructure code (auth
 * prime / service role) that must translate a login identity into the
 * principal UUID the TypeORM adapter binds transaction-locally to
 * `app.principal_id`; it is not meant to run on an RLS-restricted application
 * session.
 */
import { ValidationError } from "@decaf-ts/db-decorators";

/**
 * @description Minimal SQL client contract for the principal-subject resolver
 * @summary Structural subset consumed by `resolvePrincipalForSubject`; any
 * privileged client able to run parameterized queries (for example a `pg`
 * `Client` or a TypeORM `QueryRunner`) satisfies it. The resolver requires a
 * privileged auth-prime/service-role client because the helper function is
 * `REVOKE`d from `PUBLIC`.
 * @interface PrincipalSubjectQueryClient
 */
export interface PrincipalSubjectQueryClient {
  /**
   * @description Executes a parameterized SQL statement
   * @param {string} sql - The SQL text with positional parameters.
   * @param {any[]} [values] - Positional parameter values.
   * @returns {Promise<unknown>} The raw driver result (a rows array or an object with a `rows` array).
   */
  query(sql: string, values?: any[]): Promise<unknown>;
}

/**
 * @description Pattern enforcing UUID shape on resolved principals and tenant ids
 * @summary Used to validate the optional `tenantId` argument and to fail
 * closed on driver results that are not UUID-shaped strings.
 * @const PRINCIPAL_UUID_PATTERN
 */
export const PRINCIPAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description Resolves the principal UUID for an authenticated subject
 * @summary Calls the `SECURITY DEFINER` helper
 * `app_rls_principal_for_subject(text, uuid)` through the given privileged
 * client with fully parameterized SQL. Fails closed: an empty subject, an
 * ambiguous subject (the helper returns `NULL` unless exactly one principal
 * matches), and driver results that are not UUID-shaped strings all resolve to
 * `undefined` rather than throwing, so callers handle "no principal" uniformly
 * by denying. Requires a privileged auth-prime/service-role client; this
 * resolver must never be invoked with an application session client.
 * @function resolvePrincipalForSubject
 * @param {PrincipalSubjectQueryClient} client - Privileged client used to run the helper query.
 * @param {string} subject - The authenticated subject id (`principals.subject_id`).
 * @param {string} [tenantId] - Optional tenant UUID scoping the lookup.
 * @returns {Promise<string | undefined>} The principal UUID, or `undefined` when none can be resolved.
 * @throws {ValidationError} When the client is not query-capable, or `tenantId` is provided but not a UUID.
 * @example
 * const principalId = await resolvePrincipalForSubject(pgClient, authSubject, tenantId);
 * if (!principalId)
 *   throw new Error("No principal for subject"); // fail closed
 */
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
    if (typeof tenantId !== "string" || !PRINCIPAL_UUID_PATTERN.test(tenantId))
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
  return PRINCIPAL_UUID_PATTERN.test(normalized) ? normalized : undefined;
}
