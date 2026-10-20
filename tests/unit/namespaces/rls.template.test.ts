/**
 * @module integrations/tests/rls-template
 * @summary Unit coverage for the namespace RLS SQL template.
 * @description Verifies table coverage, policy DDL generation, and that the
 * checked-in `sql/002_rls.sql` artifact stays in sync with the TypeScript
 * template.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InternalError } from "@decaf-ts/db-decorators";
import { NAMESPACE_RLS_POLICY_SETS, RLS_FUNCTION_STATEMENTS, assertRlsTableCoverage, rlsBootstrapStatements, rlsPolicyStatements, rlsPolicyTables } from "../../../src/namespaces/rls/rls.template";
import { RLS_PROTECTED_TABLES } from "../../../src/namespaces/rls/rls.constants";
import type { RlsPolicySet } from "../../../src/namespaces/rls/rls.types";

const testDirname = dirname(fileURLToPath(import.meta.url));

describe("namespace RLS template", () => {
  it("covers every protected table", () => {
    expect(() => assertRlsTableCoverage()).not.toThrow();
    expect(new Set(rlsPolicyTables())).toEqual(new Set(RLS_PROTECTED_TABLES));
  });

  it("throws InternalError naming tables missing from coverage", () => {
    const incomplete = NAMESPACE_RLS_POLICY_SETS.filter(
      (set) => set.table !== "storage_bindings"
    );

    expect(() => assertRlsTableCoverage(incomplete)).toThrow(InternalError);
    expect(() => assertRlsTableCoverage(incomplete)).toThrow(
      "storage_bindings"
    );
  });

  it("emits enable/force, drop, and one command policy per expression", () => {
    const policySets: RlsPolicySet[] = [
      {
        table: "widgets",
        select: "tenant_id = 1",
        insert: "tenant_id = 1",
        update: "tenant_id = 1",
        delete: "tenant_id = 1",
      },
    ];

    const statements = rlsPolicyStatements(policySets);

    expect(statements).toContain(
      "ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;"
    );
    expect(statements).toContain(
      "ALTER TABLE widgets FORCE ROW LEVEL SECURITY;"
    );
    expect(statements).toContain(
      "DROP POLICY IF EXISTS widgets_select_policy ON widgets;"
    );
    expect(statements).toContain(
      "CREATE POLICY widgets_select_policy ON widgets FOR SELECT USING (tenant_id = 1);"
    );
    expect(statements).toContain(
      "CREATE POLICY widgets_insert_policy ON widgets FOR INSERT WITH CHECK (tenant_id = 1);"
    );
    expect(statements).toContain(
      "CREATE POLICY widgets_update_policy ON widgets FOR UPDATE USING (tenant_id = 1) WITH CHECK (tenant_id = 1);"
    );
    expect(statements).toContain(
      "CREATE POLICY widgets_delete_policy ON widgets FOR DELETE USING (tenant_id = 1);"
    );
  });

  it("omits the policy when its expression is omitted", () => {
    const statements = rlsPolicyStatements([
      { table: "widgets", select: "true" },
    ]).join("\n");

    expect(statements).toContain("FOR SELECT");
    expect(statements).not.toContain("FOR INSERT");
    expect(statements).not.toContain("FOR UPDATE");
    expect(statements).not.toContain("FOR DELETE");
    expect(statements).not.toContain("widgets_insert_policy");
    expect(statements).not.toContain("widgets_update_policy");
    expect(statements).not.toContain("widgets_delete_policy");
  });

  it("prefixes policy names with a sanitized table name", () => {
    const statements = rlsPolicyStatements([
      { table: "public.widgets", select: "true" },
    ]);

    expect(statements).toContain(
      "CREATE POLICY public_widgets_select_policy ON public.widgets FOR SELECT USING (true);"
    );
    expect(statements).toContain(
      "DROP POLICY IF EXISTS public_widgets_select_policy ON public.widgets;"
    );
  });

  it("skips enable/force when enabled is false", () => {
    const statements = rlsPolicyStatements([
      { table: "widgets", select: "true", enable: false },
    ]);

    expect(statements.join("\n")).not.toContain("ENABLE ROW LEVEL SECURITY");
    expect(statements.join("\n")).not.toContain("FORCE ROW LEVEL SECURITY");
    expect(statements.join("\n")).toContain("FOR SELECT");
  });

  it("builds the bootstrap list as functions followed by policies", () => {
    const statements = rlsBootstrapStatements();

    expect(statements.slice(0, RLS_FUNCTION_STATEMENTS.length)).toEqual([
      ...RLS_FUNCTION_STATEMENTS,
    ]);
    expect(statements.slice(RLS_FUNCTION_STATEMENTS.length)).toEqual(
      rlsPolicyStatements()
    );
  });

  it("keeps sql/002_rls.sql byte-identical to the generated template", () => {
    const artifactPath = resolve(
      testDirname,
      "../../../sql/002_rls.sql"
    );
    const artifact = readFileSync(artifactPath, "utf8").replace(/\r\n/g, "\n");
    const lines = artifact.split("\n");
    const header = lines.slice(0, 3).join("\n");
    const body = lines.slice(3).join("\n").replace(/\n+$/, "");
    const expectedBody = rlsBootstrapStatements()
      .join("\n")
      .replace(/\n+$/, "");

    expect(header).toBe(
      [
        "-- Namespace row-level security template.",
        "-- Generated from src/namespaces/rls/rls.template.ts; do not edit by hand.",
        "-- Apply with RlsBootstrapService.apply() or a migration runner.",
      ].join("\n")
    );
    expect(body).toBe(expectedBody);
  });
});
