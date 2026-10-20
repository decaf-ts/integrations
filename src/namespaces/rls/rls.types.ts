/**
 * @module integrations/namespaces/rls/types
 * @summary Types shared by the namespace row-level-security template and services.
 * @description Defines the minimal query-executor contract (compatible with
 * `pg.Client`/`pg.Pool`), the policy descriptor used to generate DDL, and the
 * bootstrap/session configuration shapes.
 */

/**
 * @description Minimal asynchronous SQL executor required by the RLS services.
 * @summary Matches the shape of `pg.Client.query()` without importing `pg` at
 * runtime. Consumers can pass a `pg.Client`, a `pg.Pool`, or any compatible
 * wrapper (including test doubles).
 */
export interface RlsQueryExecutor {
  query(
    sql: string,
    values?: unknown[]
  ): Promise<{ rowCount?: number | null; rows?: unknown[] }>;
}

/**
 * @description A set of row-level-security policies for one table.
 * @summary Each expression is a PostgreSQL boolean expression evaluated against
 * the row. `insert` uses `WITH CHECK`; `update` uses `USING` and `WITH CHECK`.
 */
export interface RlsPolicySet {
  /**
   * @description Table name (optionally schema-qualified) to protect.
   */
  table: string;
  /**
   * @description `USING` expression for `SELECT`; omit to leave `SELECT` denied.
   */
  select?: string;
  /**
   * @description `WITH CHECK` expression for `INSERT`; omit to deny inserts.
   */
  insert?: string;
  /**
   * @description `USING`/`WITH CHECK` expression for `UPDATE`; omit to deny updates.
   */
  update?: string;
  /**
   * @description `USING` expression for `DELETE`; omit to deny deletes.
   */
  delete?: string;
  /**
   * @description Whether to also emit `ENABLE`/`FORCE ROW LEVEL SECURITY`.
   * @default true
   */
  enable?: boolean;
}

/**
 * @description Configuration accepted by {@link RlsBootstrapService}.
 */
export interface RlsBootstrapConfig {
  /**
   * @description Statements to apply instead of the bundled namespace template.
   * @summary Useful for targeted tests or partial deployments. Statements are
   * executed sequentially and must be idempotent when applied repeatedly.
   */
  statements?: string[];
  /**
   * @description Policy sets to generate instead of the bundled namespace policy
   * template. Function helpers are still emitted unless `statements` is supplied.
   */
  policies?: RlsPolicySet[];
}

/**
 * @description Options for {@link runAsPrincipal}.
 */
export interface RunAsPrincipalOptions {
  /**
   * @description Commit the transaction when the callback succeeds.
   * @default false — the transaction is rolled back to keep tests isolated.
   */
  commit?: boolean;
}
