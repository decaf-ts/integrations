/**
 * @module integrations/namespaces/rls/bootstrap
 * @summary Bootstrap service that applies the namespace row-level-security template.
 * @description Wires the SQL template into a query executor (for example a
 * `pg.Client`) so deployments apply the policies through application bootstrap
 * or a migration runner instead of hand-running SQL. Also exposes helpers
 * that bind `app.principal_id` transaction-locally for request-scoped access.
 */
import { ClientBasedService } from "@decaf-ts/core";
import { InternalError, ValidationError } from "@decaf-ts/db-decorators";
import {
  RLS_FUNCTION_STATEMENTS,
  rlsBootstrapStatements,
  rlsPolicyStatements,
} from "./rls.template";
import type {
  RlsBootstrapConfig,
  RlsQueryExecutor,
  RunAsPrincipalOptions,
} from "./rls.types";
import { RLS_FUNCTION_OWNER_QUERY, RLS_SETTINGS } from "./rls.constants";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description Thrown when the executor role cannot safely own the RLS helper functions.
 * @summary Raised by
 * `RlsBootstrapService.assertFunctionOwnerPrivileges()` when the current
 * database role is neither `SUPERUSER` nor `BYPASSRLS` (or when its
 * privileges cannot be determined). Extends
 * `{@link InternalError}` so callers can catch it generically, while
 * carrying the distinctive `RlsFunctionOwnerError` name for
 * fail-closed matching.
 * @class RlsFunctionOwnerError
 * @category Namespaces
 */
export class RlsFunctionOwnerError extends InternalError {
  constructor(message: string) {
    super(message);
    this.name = "RlsFunctionOwnerError";
  }
}

/**
 * @description Options accepted by the transaction-local RLS binding helpers.
 * @summary Session-wide binding is not supported: the only acceptable value is
 * `local: true`, which is also the default. A `local: false` request is
 * rejected with `ValidationError` before any SQL is sent, because a
 * session-wide setting on a pooled connection leaks across requests.
 * @interface RlsBindingOptions
 * @property {true} [local] - Must be `true` or omitted (the default is `true`);
 * any other value is rejected before any SQL is sent.
 */
export interface RlsBindingOptions {
  local?: true;
}

function assertTransactionLocalBinding(
  method: string,
  options: RlsBindingOptions | undefined
): void {
  if (options && options.local !== undefined && options.local !== true) {
    throw new ValidationError(
      `${method} only supports transaction-local binding: session-wide binding is not allowed`
    );
  }
}

/**
 * @description Validates a principal identifier before binding it to the
 * `app.principal_id` RLS setting.
 * @summary Fail-closed shape guard shared by the binding helpers: the value
 * must be a non-empty UUID string. On failure it throws a `ValidationError`
 * with a fixed message that never echoes the rejected value, so invalid input
 * cannot leak into error surfaces or logs.
 * @function assertPrincipalId
 * @param {string} principalId - Candidate principal (or tenant) UUID to validate.
 * @returns {void}
 * @throws {ValidationError} When the value is empty or not UUID-shaped; the message does not include the rejected value.
 */
export function assertPrincipalId(principalId: string): void {
  if (!principalId || !UUID_PATTERN.test(principalId)) {
    throw new ValidationError("Invalid RLS principal id");
  }
}

/**
 * @description Applies the namespace RLS template through a SQL executor.
 * @summary The service boots with a SQL executor (`pg.Client`, `pg.Pool`, or a
 * compatible wrapper) and applies the namespace row-level-security template:
 * function plus policy DDL executed sequentially. It is the deployment-side
 * entry point for the RLS template, meant to run during application bootstrap
 * or a migration runner instead of hand-running SQL. The template is
 * idempotent and may run on every deployment.
 * @class RlsBootstrapService
 * @category Namespaces
 */
export class RlsBootstrapService extends ClientBasedService<
  RlsQueryExecutor,
  RlsBootstrapConfig
> {
  constructor() {
    super();
  }

  async initialize(...args: any[]): Promise<{
    config: RlsBootstrapConfig;
    client: RlsQueryExecutor;
  }> {
    const client = args[0] as RlsQueryExecutor | undefined;
    if (!client || typeof client.query !== "function") {
      throw new ValidationError(
        "RlsBootstrapService requires a query executor as its first argument"
      );
    }
    const config = (args[1] as RlsBootstrapConfig | undefined) ?? {};
    return { config, client };
  }

  /**
   * @description Applies the configured (or bundled) RLS statement list.
   * @summary The service is booted with an executor (`pg.Client`, `pg.Pool`, or a
   * compatible wrapper) and applies function plus policy DDL sequentially. The
   * template is idempotent and may run on every deployment. Before any DDL is
   * sent, `assertFunctionOwnerPrivileges()` verifies that the current
   * executor role is `SUPERUSER` or `BYPASSRLS` and fails closed otherwise,
   * so `SECURITY DEFINER` helper functions are never created with an owner
   * that would recurse under `FORCE ROW LEVEL SECURITY`.
   * @return {Promise<{applied: number}>} The number of statements executed.
   * @throws {RlsFunctionOwnerError} When the executor role is neither `SUPERUSER` nor `BYPASSRLS`, or its privileges cannot be determined.
   * @throws {InternalError} When the resolved statement list is empty.
   */
  async apply(...args: any[]): Promise<{ applied: number }> {
    const { log } = (await this.logCtx(args, "apply", true)).for(this.apply);
    const statements = this.statements();
    if (!statements.length) {
      throw new InternalError("No RLS statements to apply");
    }
    await this.assertFunctionOwnerPrivileges(...args);
    log.verbose(`Applying ${statements.length} RLS statements`);
    for (const statement of statements) {
      await this.client.query(statement);
    }
    log.info(
      `Applied namespace RLS template (${statements.length} statements)`
    );
    return { applied: statements.length };
  }

  /**
   * @description Verifies that the current executor role can own the RLS helper functions.
   * @summary Runs `RLS_FUNCTION_OWNER_QUERY` through the configured executor
   * and reads the current role's `rolsuper`/`rolbypassrls` flags from
   * `pg_roles`. Fails closed: when the row is missing or the flags are not
   * booleans, it throws `RlsFunctionOwnerError` with the same
   * fail-closed semantics as an explicit privilege failure. Called
   * automatically by `apply()` before any DDL is executed.
   * @param args - Optional trailing decaf `Context` arguments forwarded to the log context.
   * @return Resolves when the current role is `SUPERUSER` or `BYPASSRLS`.
   * @throws {RlsFunctionOwnerError} When the executor role is neither `SUPERUSER` nor `BYPASSRLS`, or when its privileges cannot be determined from `pg_roles`.
   */
  async assertFunctionOwnerPrivileges(...args: any[]): Promise<void> {
    const { log } = (
      await this.logCtx(args, "assertFunctionOwnerPrivileges", true)
    ).for(this.assertFunctionOwnerPrivileges);
    const result = await this.client.query(RLS_FUNCTION_OWNER_QUERY);
    const row = (result.rows?.[0] ?? undefined) as
      | { rolname?: string; rolsuper?: boolean; rolbypassrls?: boolean }
      | undefined;
    const roleName = row?.rolname
      ? JSON.stringify(row.rolname)
      : "current_user";
    if (
      typeof row?.rolsuper !== "boolean" ||
      typeof row?.rolbypassrls !== "boolean"
    ) {
      throw new RlsFunctionOwnerError(
        `Cannot apply the namespace RLS template: could not determine the privileges of ${roleName}. ` +
          "The SECURITY DEFINER helper functions require a SUPERUSER or BYPASSRLS owner; refusing to " +
          "apply policies that would recurse under FORCE ROW LEVEL SECURITY."
      );
    }
    if (!row.rolsuper && !row.rolbypassrls) {
      throw new RlsFunctionOwnerError(
        `Cannot apply the namespace RLS template as ${roleName}: the executor role is neither SUPERUSER ` +
          "nor BYPASSRLS. The SECURITY DEFINER helper functions must be owned by a role that bypasses RLS, " +
          "otherwise every policy evaluation recurses under FORCE ROW LEVEL SECURITY and fails. Connect as " +
          "the database owner/BYPASSRLS migration role, or create the helper functions with a dedicated " +
          "BYPASSRLS owner."
      );
    }
    log.verbose(`Verified RLS function owner privileges for ${roleName}`);
  }

  /**
   * @description Resolves the statement list for the active configuration.
   */
  statements(): string[] {
    const config = this._config ?? {};
    if (config.statements) return [...config.statements];
    if (config.policies) {
      return [
        ...RLS_FUNCTION_STATEMENTS,
        ...rlsPolicyStatements(config.policies),
      ];
    }
    return rlsBootstrapStatements();
  }

  /**
   * @description Binds the acting principal for the current transaction.
   * @summary Issues parameterized `SELECT set_config($1, $2, true)` after
   * validation, so the binding lives only for the current transaction and is
   * discarded on commit/rollback — safe on pooled connections. A session-wide
   * binding request fails with `ValidationError` before any SQL is sent, and
   * the verbose log records only that a binding happened, never the principal
   * id.
   * @param principalId Principal UUID stored in `app.principal_id`.
   * @param options Only `local: true` (the default) is accepted; the binding is
   * always transaction-local and is discarded on commit/rollback.
   * @returns {Promise<void>} Resolves once the setting is bound transaction-locally.
   * @throws {ValidationError} When the principal id is invalid or a session-wide binding is requested.
   */
  async setPrincipal(
    principalId: string,
    options: RlsBindingOptions = {},
    ...args: any[]
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "setPrincipal", true)).for(
      this.setPrincipal
    );
    assertPrincipalId(principalId);
    assertTransactionLocalBinding("setPrincipal", options);
    await this.client.query("SELECT set_config($1, $2, true)", [
      RLS_SETTINGS.Principal,
      principalId,
    ]);
    log.verbose("Bound RLS principal (transaction-local)");
  }

  /**
   * @description Binds the acting tenant for the current transaction.
   * @summary Issues parameterized `SELECT set_config($1, $2, true)` after
   * validation, so the binding lives only for the current transaction and is
   * discarded on commit/rollback — safe on pooled connections. A session-wide
   * binding request fails with `ValidationError` before any SQL is sent, and
   * the verbose log records only that a binding happened, never the tenant
   * id.
   * @param tenantId Tenant UUID stored in `app.tenant_id`.
   * @param options Only `local: true` (the default) is accepted; the binding is
   * always transaction-local and is discarded on commit/rollback.
   * @returns {Promise<void>} Resolves once the setting is bound transaction-locally.
   * @throws {ValidationError} When the tenant id is invalid or a session-wide binding is requested.
   */
  async setTenant(
    tenantId: string,
    options: RlsBindingOptions = {},
    ...args: any[]
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "setTenant", true)).for(
      this.setTenant
    );
    assertPrincipalId(tenantId);
    assertTransactionLocalBinding("setTenant", options);
    await this.client.query("SELECT set_config($1, $2, true)", [
      RLS_SETTINGS.Tenant,
      tenantId,
    ]);
    log.verbose("Bound RLS tenant (transaction-local)");
  }

  /**
   * @description Clears the acting principal for the current transaction.
   * @summary Resets `app.principal_id` to the empty string with
   * `SELECT set_config($1, $2, true)`, so the clear is also transaction-local
   * and never reaches the pooled session. A session-wide clear request fails
   * with `ValidationError` before any SQL is sent.
   * @param options Only `local: true` (the default) is accepted; the clear is
   * always transaction-local and does not reach the pooled session.
   * @returns {Promise<void>} Resolves once the setting is cleared transaction-locally.
   * @throws {ValidationError} When a session-wide clear is requested.
   */
  async clearPrincipal(
    options: RlsBindingOptions = {},
    ...args: any[]
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "clearPrincipal", true)).for(
      this.clearPrincipal
    );
    assertTransactionLocalBinding("clearPrincipal", options);
    await this.client.query("SELECT set_config($1, $2, true)", [
      RLS_SETTINGS.Principal,
      "",
    ]);
    log.verbose("Cleared RLS principal (transaction-local)");
  }

  /**
   * @description Returns the principal currently bound to the connection.
   */
  async currentPrincipal(...args: any[]): Promise<string | null> {
    const { log } = (await this.logCtx(args, "currentPrincipal", true)).for(
      this.currentPrincipal
    );
    log.verbose("Reading current RLS principal");
    const result = await this.client.query(
      "SELECT app_rls_principal_id() AS principal_id"
    );
    const row = (result.rows?.[0] ?? {}) as { principal_id?: string | null };
    return row.principal_id ?? null;
  }
}

/**
 * @description Runs a callback inside a transaction with the RLS principal bound.
 * @summary The executor must be a single connection (`pg.Client`), not a pool,
 * because the transaction and the `app.principal_id` setting are
 * connection-scoped. By default the transaction is rolled back, keeping
 * integration-test mutations isolated; pass `{ commit: true }` for real writes.
 */
export async function runAsPrincipal<T>(
  executor: RlsQueryExecutor,
  principalId: string,
  run: (executor: RlsQueryExecutor) => Promise<T>,
  options: RunAsPrincipalOptions = {}
): Promise<T> {
  assertPrincipalId(principalId);
  await executor.query("BEGIN");
  try {
    await executor.query("SELECT set_config($1, $2, true)", [
      RLS_SETTINGS.Principal,
      principalId,
    ]);
    const result = await run(executor);
    await executor.query(options.commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await executor.query("ROLLBACK");
    } catch {
      // preserve the original failure
    }
    throw error;
  }
}
