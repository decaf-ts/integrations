/**
 * @module integrations/namespaces/rls/bootstrap
 * @summary Bootstrap service that applies the namespace row-level-security template.
 * @description Wires the SQL template into a query executor (for example a
 * `pg.Client`) so deployments apply the policies through application bootstrap
 * or a migration runner instead of hand-running SQL. Also exposes session
 * helpers that bind `app.principal_id` for request-scoped access.
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
import { RLS_SETTINGS } from "./rls.constants";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description Validates a principal identifier before binding it to the RLS
 * session setting.
 */
export function assertPrincipalId(principalId: string): void {
  if (!principalId || !UUID_PATTERN.test(principalId)) {
    throw new ValidationError(
      `Invalid RLS principal id: ${JSON.stringify(principalId)}`
    );
  }
}

/**
 * @description Applies the namespace RLS template through a SQL executor.
 * @summary The service is booted with an executor (`pg.Client`, `pg.Pool`, or a
 * compatible wrapper) and applies function plus policy DDL sequentially. The
 * template is idempotent and may run on every deployment.
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
   * @return The number of statements executed.
   */
  async apply(...args: any[]): Promise<{ applied: number }> {
    const { log } = (await this.logCtx(args, "apply", true)).for(this.apply);
    const statements = this.statements();
    if (!statements.length) {
      throw new InternalError("No RLS statements to apply");
    }
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
   * @description Binds the acting principal for subsequent queries.
   * @param principalId Principal UUID stored in `app.principal_id`.
   * @param options.local When true (default), the setting is transaction-local
   * and is discarded on commit/rollback. Set false for a session-wide binding.
   */
  async setPrincipal(
    principalId: string,
    options: { local?: boolean } = {},
    ...args: any[]
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "setPrincipal", true)).for(
      this.setPrincipal
    );
    assertPrincipalId(principalId);
    const local = options.local ?? true;
    await this.client.query("SELECT set_config($1, $2, $3)", [
      RLS_SETTINGS.Principal,
      principalId,
      local,
    ]);
    log.verbose(`Bound RLS principal ${principalId} (local=${local})`);
  }

  /**
   * @description Binds the acting tenant for diagnostic or multi-tenant checks.
   */
  async setTenant(
    tenantId: string,
    options: { local?: boolean } = {},
    ...args: any[]
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "setTenant", true)).for(
      this.setTenant
    );
    assertPrincipalId(tenantId);
    const local = options.local ?? true;
    await this.client.query("SELECT set_config($1, $2, $3)", [
      RLS_SETTINGS.Tenant,
      tenantId,
      local,
    ]);
    log.verbose(`Bound RLS tenant ${tenantId} (local=${local})`);
  }

  /**
   * @description Clears the acting principal for the session/transaction.
   */
  async clearPrincipal(
    options: { local?: boolean } = {},
    ...args: any[]
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "clearPrincipal", true)).for(
      this.clearPrincipal
    );
    const local = options.local ?? true;
    await this.client.query("SELECT set_config($1, $2, $3)", [
      RLS_SETTINGS.Principal,
      "",
      local,
    ]);
    log.verbose(`Cleared RLS principal (local=${local})`);
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
