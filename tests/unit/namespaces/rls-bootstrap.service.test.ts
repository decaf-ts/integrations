/**
 * @module integrations/tests/rls-bootstrap-service
 * @summary Unit coverage for the RLS bootstrap service and transaction helper.
 * @description Exercises statement resolution, apply ordering, principal
 * binding, and the rollback/commit contract of {@link runAsPrincipal} against a
 * fake query executor.
 */
import { InternalError, ValidationError } from "@decaf-ts/db-decorators";
import { RLS_FUNCTION_STATEMENTS, rlsBootstrapStatements, rlsPolicyStatements } from "../../../src/namespaces/rls/rls.template";
import {
  RlsBootstrapService,
  RlsFunctionOwnerError,
  assertPrincipalId,
  runAsPrincipal,
} from "../../../src/namespaces/rls/rls-bootstrap.service";
import type { RlsBindingOptions } from "../../../src/namespaces/rls/rls-bootstrap.service";
import {
  RLS_FUNCTION_OWNER_QUERY,
  RLS_SETTINGS,
} from "../../../src/namespaces/rls/rls.constants";
import type { RlsQueryExecutor } from "../../../src/namespaces/rls/rls.types";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PRINCIPAL_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_WIDE_OPTIONS = {
  local: false,
} as unknown as RlsBindingOptions;
const SET_CONFIG_SQL = "SELECT set_config($1, $2, true)";

const SUPERUSER_ROW = [{ rolname: "decaf", rolsuper: true, rolbypassrls: false }];
const BYPASSRLS_ROW = [
  { rolname: "decaf", rolsuper: false, rolbypassrls: true },
];
const NOBYPASSRLS_ROW = [
  { rolname: "rls_app", rolsuper: false, rolbypassrls: false },
];

interface RecordedCall {
  sql: string;
  values?: unknown[];
}

function fakeExecutor(
  rows: unknown[] = [],
  roleRows: unknown[] = SUPERUSER_ROW
): RlsQueryExecutor & {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql === RLS_FUNCTION_OWNER_QUERY) {
        return { rowCount: roleRows.length, rows: roleRows };
      }
      return { rowCount: rows.length, rows };
    },
  };
}

function captureVerbose(service: RlsBootstrapService): string[] {
  const messages: string[] = [];
  const logger = {
    verbose: (message: unknown) => messages.push(String(message)),
    info: () => undefined,
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  (service as unknown as { logCtx: () => unknown }).logCtx = () => ({
    for: () => ({ log: logger }),
  });
  return messages;
}

function setConfigCalls(
  executor: ReturnType<typeof fakeExecutor>
): RecordedCall[] {
  return executor.calls.filter((call) => call.sql.includes("set_config("));
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

  it("does not echo the rejected value in its ValidationError", () => {
    const rejected = "not-a-uuid-principal-SECRET";

    const failure = (() => {
      try {
        assertPrincipalId(rejected);
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as Error).message).not.toContain(rejected);
    expect((failure as Error).message).not.toContain("SECRET");
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
    expect(executor.calls.map((call) => call.sql)).toEqual([
      RLS_FUNCTION_OWNER_QUERY,
      ...rlsBootstrapStatements(),
    ]);
  });

  it("applies the template when the executor is a SUPERUSER", async () => {
    const executor = fakeExecutor([], SUPERUSER_ROW);
    const service = new RlsBootstrapService();
    await service.boot(executor);

    await expect(service.apply()).resolves.toEqual({
      applied: rlsBootstrapStatements().length,
    });
  });

  it("applies the template when the executor has BYPASSRLS", async () => {
    const executor = fakeExecutor([], BYPASSRLS_ROW);
    const service = new RlsBootstrapService();
    await service.boot(executor);

    await expect(service.apply()).resolves.toEqual({
      applied: rlsBootstrapStatements().length,
    });
  });

  it("rejects a NOBYPASSRLS executor before running any template DDL", async () => {
    const executor = fakeExecutor([], NOBYPASSRLS_ROW);
    const service = new RlsBootstrapService();
    await service.boot(executor);

    const failure = await service.apply().catch((error) => error);

    expect(failure).toBeInstanceOf(RlsFunctionOwnerError);
    expect(failure).toBeInstanceOf(InternalError);
    expect(failure.message).toMatch(/SUPERUSER/);
    expect(failure.message).toMatch(/BYPASSRLS/);
    expect(failure.message).toContain("rls_app");
    expect(executor.calls).toEqual([
      { sql: RLS_FUNCTION_OWNER_QUERY, values: undefined },
    ]);
  });

  it("rejects when the executor privileges cannot be determined", async () => {
    const executor = fakeExecutor([], []);
    const service = new RlsBootstrapService();
    await service.boot(executor);

    const failure = await service.apply().catch((error) => error);

    expect(failure).toBeInstanceOf(RlsFunctionOwnerError);
    expect(failure.message).toMatch(/SUPERUSER/);
    expect(failure.message).toMatch(/BYPASSRLS/);
    expect(executor.calls).toEqual([
      { sql: RLS_FUNCTION_OWNER_QUERY, values: undefined },
    ]);
  });

  it("rejects when the role row omits the privilege booleans", async () => {
    const executor = fakeExecutor([], [{ rolname: "decaf" }]);
    const service = new RlsBootstrapService();
    await service.boot(executor);

    const failure = await service.apply().catch((error) => error);

    expect(failure).toBeInstanceOf(RlsFunctionOwnerError);
    expect(executor.calls).toEqual([
      { sql: RLS_FUNCTION_OWNER_QUERY, values: undefined },
    ]);
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
    await service.setTenant(TENANT_ID);
    await service.clearPrincipal();

    const bindings = setConfigCalls(executor);
    expect(bindings).toEqual([
      {
        sql: SET_CONFIG_SQL,
        values: [RLS_SETTINGS.Principal, PRINCIPAL_ID],
      },
      {
        sql: SET_CONFIG_SQL,
        values: [RLS_SETTINGS.Tenant, TENANT_ID],
      },
      {
        sql: SET_CONFIG_SQL,
        values: [RLS_SETTINGS.Principal, ""],
      },
    ]);
    expect(bindings).toHaveLength(3);
    expect(
      bindings.some((call) => call.values?.includes(false))
    ).toBe(false);
  });

  it.each([
    [
      "setPrincipal",
      (service: RlsBootstrapService) =>
        service.setPrincipal(PRINCIPAL_ID, SESSION_WIDE_OPTIONS),
    ],
    [
      "setTenant",
      (service: RlsBootstrapService) =>
        service.setTenant(TENANT_ID, SESSION_WIDE_OPTIONS),
    ],
    [
      "clearPrincipal",
      (service: RlsBootstrapService) =>
        service.clearPrincipal(SESSION_WIDE_OPTIONS),
    ],
  ])(
    "rejects a session-wide %s binding before issuing any SQL",
    async (_method, invoke) => {
      const executor = fakeExecutor();
      const service = new RlsBootstrapService();
      await service.boot(executor);

      await expect(invoke(service)).rejects.toBeInstanceOf(ValidationError);
      expect(setConfigCalls(executor)).toHaveLength(0);
      expect(executor.calls).toHaveLength(0);
    }
  );

  it("accepts an explicit local: true binding without a session-wide write", async () => {
    const executor = fakeExecutor();
    const service = new RlsBootstrapService();
    await service.boot(executor);

    await service.setPrincipal(PRINCIPAL_ID, { local: true });
    await service.setTenant(TENANT_ID, { local: true });
    await service.clearPrincipal({ local: true });

    const bindings = setConfigCalls(executor);
    expect(bindings).toHaveLength(3);
    expect(bindings.every((call) => call.sql === SET_CONFIG_SQL)).toBe(true);
    expect(bindings.every((call) => call.values?.length === 2)).toBe(true);
    expect(bindings.map((call) => call.values)).toEqual([
      [RLS_SETTINGS.Principal, PRINCIPAL_ID],
      [RLS_SETTINGS.Tenant, TENANT_ID],
      [RLS_SETTINGS.Principal, ""],
    ]);
    expect(
      bindings.some((call) => call.values?.includes(false))
    ).toBe(false);
  });

  it("redacts principal and tenant identifiers from verbose binding logs", async () => {
    const executor = fakeExecutor();
    const service = new RlsBootstrapService();
    await service.boot(executor);
    const messages = captureVerbose(service);

    await service.setPrincipal(PRINCIPAL_ID);
    await service.setTenant(TENANT_ID);
    await service.clearPrincipal();

    expect(messages.length).toBeGreaterThanOrEqual(3);
    const output = messages.join("\n");
    expect(output).not.toContain(PRINCIPAL_ID);
    expect(output).not.toContain(PRINCIPAL_ID.toUpperCase());
    expect(output).not.toContain(TENANT_ID);
    expect(output).not.toContain(TENANT_ID.toUpperCase());
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
