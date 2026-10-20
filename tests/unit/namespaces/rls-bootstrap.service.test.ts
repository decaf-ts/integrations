/**
 * @module integrations/tests/rls-bootstrap-service
 * @summary Unit coverage for the RLS bootstrap service and transaction helper.
 * @description Exercises statement resolution, apply ordering, principal
 * binding, and the rollback/commit contract of {@link runAsPrincipal} against a
 * fake query executor.
 */
import { InternalError, ValidationError } from "@decaf-ts/db-decorators";
import { RLS_FUNCTION_STATEMENTS, rlsBootstrapStatements, rlsPolicyStatements } from "../../../src/namespaces/rls/rls.template";
import { RlsBootstrapService, assertPrincipalId, runAsPrincipal } from "../../../src/namespaces/rls/rls-bootstrap.service";
import { RLS_SETTINGS } from "../../../src/namespaces/rls/rls.constants";
import type { RlsQueryExecutor } from "../../../src/namespaces/rls/rls.types";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PRINCIPAL_ID = "22222222-2222-4222-8222-222222222222";

interface RecordedCall {
  sql: string;
  values?: unknown[];
}

function fakeExecutor(rows: unknown[] = []): RlsQueryExecutor & {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rowCount: rows.length, rows };
    },
  };
}

describe("assertPrincipalId", () => {
  it("accepts UUIDs", () => {
    expect(() => assertPrincipalId(PRINCIPAL_ID)).not.toThrow();
    expect(() =>
      assertPrincipalId(PRINCIPAL_ID.toUpperCase())
    ).not.toThrow();
  });

  it.each([
    ["empty", ""],
    ["non-uuid", "not-a-uuid"],
    ["truncated", "11111111-1111-4111-8111-11111111111"],
    ["extra characters", `${PRINCIPAL_ID}-suffix`],
    ["undefined-like", undefined as unknown as string],
  ])("rejects %s values with ValidationError", (_label, value) => {
    expect(() => assertPrincipalId(value)).toThrow(ValidationError);
  });
});

describe("RlsBootstrapService", () => {
  it("rejects a missing executor at boot", async () => {
    const service = new RlsBootstrapService();

    await expect(service.boot(undefined)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("rejects an executor without a query function at boot", async () => {
    const service = new RlsBootstrapService();

    await expect(
      service.boot({ query: "not-a-function" } as unknown as RlsQueryExecutor)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("resolves the bundled statement list by default", async () => {
    const service = new RlsBootstrapService();
    await service.boot(fakeExecutor());

    expect(service.statements()).toEqual(rlsBootstrapStatements());
  });

  it("honours a custom statement list", async () => {
    const service = new RlsBootstrapService();
    await service.boot(fakeExecutor(), {
      statements: ["SELECT 1;", "SELECT 2;"],
    });

    expect(service.statements()).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  it("builds helper functions plus custom policies", async () => {
    const policies = [{ table: "widgets", select: "true" }] as const;
    const service = new RlsBootstrapService();
    await service.boot(fakeExecutor(), { policies: [...policies] });

    expect(service.statements()).toEqual([
      ...RLS_FUNCTION_STATEMENTS,
      ...rlsPolicyStatements([...policies]),
    ]);
  });

  it("applies every statement in order against the executor", async () => {
    const executor = fakeExecutor();
    const service = new RlsBootstrapService();
    await service.boot(executor);

    const result = await service.apply();

    expect(result).toEqual({ applied: rlsBootstrapStatements().length });
    expect(executor.calls.map((call) => call.sql)).toEqual(
      rlsBootstrapStatements()
    );
  });

  it("throws InternalError when there is nothing to apply", async () => {
    const service = new RlsBootstrapService();
    await service.boot(fakeExecutor(), { statements: [] });

    await expect(service.apply()).rejects.toBeInstanceOf(InternalError);
  });

  it("binds and clears the principal with transaction-local settings", async () => {
    const executor = fakeExecutor();
    const service = new RlsBootstrapService();
    await service.boot(executor);

    await service.setPrincipal(PRINCIPAL_ID);
    await service.setPrincipal(PRINCIPAL_ID, { local: false });
    await service.setTenant(PRINCIPAL_ID);
    await service.clearPrincipal();

    expect(executor.calls).toEqual([
      {
        sql: "SELECT set_config($1, $2, $3)",
        values: [RLS_SETTINGS.Principal, PRINCIPAL_ID, true],
      },
      {
        sql: "SELECT set_config($1, $2, $3)",
        values: [RLS_SETTINGS.Principal, PRINCIPAL_ID, false],
      },
      {
        sql: "SELECT set_config($1, $2, $3)",
        values: [RLS_SETTINGS.Tenant, PRINCIPAL_ID, true],
      },
      {
        sql: "SELECT set_config($1, $2, $3)",
        values: [RLS_SETTINGS.Principal, "", true],
      },
    ]);
  });

  it("rejects an invalid principal before querying", async () => {
    const executor = fakeExecutor();
    const service = new RlsBootstrapService();
    await service.boot(executor);

    await expect(service.setPrincipal("invalid")).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(executor.calls).toHaveLength(0);
  });

  it("reads the bound principal from the executor", async () => {
    const executor = fakeExecutor([{ principal_id: PRINCIPAL_ID }]);
    const service = new RlsBootstrapService();
    await service.boot(executor);

    await expect(service.currentPrincipal()).resolves.toBe(PRINCIPAL_ID);
    expect(executor.calls[0].sql).toContain("app_rls_principal_id()");
  });
});

describe("runAsPrincipal", () => {
  it("rolls back by default after running the callback", async () => {
    const executor = fakeExecutor();
    const observed: string[] = [];

    await runAsPrincipal(executor, PRINCIPAL_ID, async () => {
      observed.push((executor as ReturnType<typeof fakeExecutor>).calls[1].sql);
      return "result";
    }).then((result) => expect(result).toBe("result"));

    const sql = (executor as ReturnType<typeof fakeExecutor>).calls.map(
      (call) => call.sql
    );
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toBe("SELECT set_config($1, $2, true)");
    expect(sql.at(-1)).toBe("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    expect(observed).toEqual(["SELECT set_config($1, $2, true)"]);
  });

  it("commits when requested", async () => {
    const executor = fakeExecutor();

    await runAsPrincipal(executor, PRINCIPAL_ID, async () => undefined, {
      commit: true,
    });

    const sql = (executor as ReturnType<typeof fakeExecutor>).calls.map(
      (call) => call.sql
    );
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql).not.toContain("ROLLBACK");
  });

  it("rolls back and preserves the callback failure", async () => {
    const executor = fakeExecutor();
    const failure = new Error("callback failed");

    await expect(
      runAsPrincipal(executor, PRINCIPAL_ID, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    const sql = (executor as ReturnType<typeof fakeExecutor>).calls.map(
      (call) => call.sql
    );
    expect(sql).toEqual([
      "BEGIN",
      "SELECT set_config($1, $2, true)",
      "ROLLBACK",
    ]);
  });

  it("rejects an invalid principal before opening a transaction", async () => {
    const executor = fakeExecutor();

    await expect(
      runAsPrincipal(executor, "invalid", async () => undefined)
    ).rejects.toBeInstanceOf(ValidationError);

    expect((executor as ReturnType<typeof fakeExecutor>).calls).toHaveLength(0);
  });

  it("binds the requested principal", async () => {
    const executor = fakeExecutor();

    await runAsPrincipal(executor, SECOND_PRINCIPAL_ID, async () => undefined);

    const bindCall = (executor as ReturnType<typeof fakeExecutor>).calls[1];
    expect(bindCall.values).toEqual([RLS_SETTINGS.Principal, SECOND_PRINCIPAL_ID]);
  });
});
