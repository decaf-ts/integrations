/**
 * @module integrations/tests/unit/erpnext/ERPNextAdapterRaw
 * @summary Unit coverage for the ERPNext adapter raw-query contract:
 * aggregations, grouping, projection, error parsing, sequencing and lifecycle.
 */
import { it } from "@decaf-ts/for-testing";
import { beforeEach, describe, expect } from "@jest/globals";
import { Context, QueryError } from "@decaf-ts/core";
import { InternalError, OperationKeys } from "@decaf-ts/db-decorators";
import {
  ERPNextAdapter,
  ERPNextConnectionError,
  ERPNextContextLock,
  ERPNextCustomer,
  ERPNextDispatch,
  ERPNextError,
  ERPNextNotFoundError,
  ERPNextPaginator,
  ERPNextSalesInvoice,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextTransport,
} from "../../../src/erpnext";

let documents: Record<string, any>[] = [];
const calls: ERPNextHttpRequest[] = [];

const transport: ERPNextTransport = async (request) => {
  calls.push(request);
  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const doctype = decodeURIComponent(segments[3] ?? "");
  if (request.method === "GET" && segments.length === 4)
    return { status: 200, data: { data: documents } };
  if (request.method === "GET" && segments.length === 5) {
    const name = decodeURIComponent(segments[4]);
    const doc = documents.find((item) => item.name === name);
    return doc
      ? { status: 200, data: { data: doc } }
      : { status: 404, data: { exc_type: "DoesNotExistError" } };
  }
  if (request.method === "POST")
    return {
      status: 200,
      data: {
        data: {
          name: (request.data as Record<string, any>)?.name ?? `${doctype}-NEW`,
          ...(request.data as Record<string, any>),
        },
      },
    };
  if (request.method === "PUT")
    return {
      status: 200,
      data: {
        data: {
          name: decodeURIComponent(segments[4]),
          ...(request.data as Record<string, any>),
        },
      },
    };
  return { status: 200, data: { message: "ok" } };
};

const ctx = new Context().accumulate({ rebuildWithTransient: false });

function adapterWith(
  overrides: Partial<ConstructorParameters<typeof ERPNextAdapter>[0]> = {}
) {
  return new ERPNextAdapter({
    baseUrl: "https://erp.example.com",
    apiKey: "k",
    apiSecret: "s",
    username: "tester",
    transport,
    ...overrides,
  });
}

const adapter = adapterWith();

function raw(query: Record<string, unknown>, docsOnly = true) {
  return (adapter.raw as any)(query, docsOnly, ctx);
}

function invoice(overrides: Record<string, any> = {}) {
  return {
    name: "SINV-1",
    customer: "C1",
    customer_group: "Commercial",
    posting_date: "2026-01-01",
    status: "Draft",
    grand_total: 100,
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  documents = [
    invoice(),
    invoice({
      name: "SINV-2",
      posting_date: "2026-01-02",
      customer: "C2",
      customer_group: "Individual",
      grand_total: 200,
    }),
    invoice({
      name: "SINV-3",
      posting_date: "2026-01-03",
      status: "Paid",
      grand_total: 300,
    }),
  ];
});

describe("ERPNextAdapter.raw documents", () => {
  it("reverts documents to models by default", async () => {
    const result = await raw({ from: ERPNextSalesInvoice });
    expect(result).toHaveLength(3);
    expect(result[0]).toBeInstanceOf(ERPNextSalesInvoice);
    expect(result[0].grand_total).toBe(100);
    expect(result[0].posting_date).toBeInstanceOf(Date);
  });

  it("requests every field for an unprojected query", async () => {
    await raw({ from: ERPNextSalesInvoice });
    const fields = new URL(calls[0].url).searchParams.get("fields");
    expect(fields).toBe('["*"]');
  });

  it("projects the requested fields", async () => {
    const result = await raw({
      from: ERPNextSalesInvoice,
      select: ["customer", "grand_total"],
    });
    expect(result).toHaveLength(3);
    for (const row of result) {
      expect(row.customer).toBeTruthy();
      expect(row.grand_total).toBeTruthy();
      expect(row.status).toBeUndefined();
    }
  });

  it("includes filters, order, group and aggregates in the projection", async () => {
    await raw({
      from: ERPNextSalesInvoice,
      select: ["customer"],
      filters: [["status", "=", "Draft"]],
      orderBy: [{ field: "posting_date", direction: "asc" }],
      groupBy: ["status"],
      sum: "grand_total",
    });
    const fields = JSON.parse(
      new URL(calls[0].url).searchParams.get("fields") as string
    ) as string[];
    expect(fields).toEqual(
      expect.arrayContaining([
        "customer",
        "name",
        "status",
        "posting_date",
        "grand_total",
      ])
    );
  });

  it("applies the in-memory predicate and pagination", async () => {
    const result = await raw({
      from: ERPNextSalesInvoice,
      where: (model: ERPNextSalesInvoice) => model.status === "Draft",
      skip: 1,
      limit: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("SINV-2");
  });

  it("returns { data, count } when documents are not requested", async () => {
    const result = await raw(
      {
        from: ERPNextSalesInvoice,
        where: (model: ERPNextSalesInvoice) => model.status === "Paid",
      },
      false
    );
    expect(result.count).toBe(1);
    expect(result.data).toHaveLength(1);
  });
});

describe("ERPNextAdapter.raw aggregations", () => {
  it("counts documents and non-null fields", async () => {
    expect(await raw({ from: ERPNextSalesInvoice, count: null })).toBe(3);
    expect(await raw({ from: ERPNextSalesInvoice, count: "name" })).toBe(3);
    documents = [invoice({ grand_total: null }), invoice({ name: "SINV-2" })];
    expect(await raw({ from: ERPNextSalesInvoice, count: "grand_total" })).toBe(
      1
    );
  });

  it("counts distinct values ignoring nullish entries", async () => {
    documents = [
      invoice(),
      invoice({ name: "SINV-2" }),
      invoice({ name: "SINV-3", customer: null }),
    ];
    expect(
      await raw({ from: ERPNextSalesInvoice, countDistinct: "customer" })
    ).toBe(1);
  });

  it("computes min/max/sum/avg over numeric fields", async () => {
    expect(await raw({ from: ERPNextSalesInvoice, min: "grand_total" })).toBe(
      100
    );
    expect(await raw({ from: ERPNextSalesInvoice, max: "grand_total" })).toBe(
      300
    );
    expect(await raw({ from: ERPNextSalesInvoice, sum: "grand_total" })).toBe(
      600
    );
    expect(await raw({ from: ERPNextSalesInvoice, avg: "grand_total" })).toBe(
      200
    );
  });

  it("supports bigint values in numeric aggregations", async () => {
    documents = [
      invoice({ grand_total: BigInt(100) }),
      invoice({ name: "SINV-2", grand_total: BigInt(300) }),
    ];
    expect(await raw({ from: ERPNextSalesInvoice, sum: "grand_total" })).toBe(
      400
    );
    expect(await raw({ from: ERPNextSalesInvoice, avg: "grand_total" })).toBe(
      200
    );
    expect(await raw({ from: ERPNextSalesInvoice, max: "grand_total" })).toBe(
      BigInt(300)
    );
  });

  it("aggregates date fields", async () => {
    const min = await raw({ from: ERPNextSalesInvoice, min: "posting_date" });
    expect(min).toBeInstanceOf(Date);
    expect((min as Date).toISOString().slice(0, 10)).toBe("2026-01-01");
    const max = await raw({ from: ERPNextSalesInvoice, max: "posting_date" });
    expect((max as Date).toISOString().slice(0, 10)).toBe("2026-01-03");
    const avg = await raw({ from: ERPNextSalesInvoice, avg: "posting_date" });
    expect(avg).toBeInstanceOf(Date);
  });

  it("returns null when there are no values", async () => {
    documents = [];
    expect(await raw({ from: ERPNextSalesInvoice, min: "grand_total" })).toBe(
      null
    );
    expect(await raw({ from: ERPNextSalesInvoice, max: "grand_total" })).toBe(
      null
    );
    expect(await raw({ from: ERPNextSalesInvoice, sum: "grand_total" })).toBe(
      null
    );
    expect(await raw({ from: ERPNextSalesInvoice, avg: "grand_total" })).toBe(
      null
    );
  });

  it("rejects aggregations on non numeric attribute types", async () => {
    await expect(
      raw({ from: ERPNextSalesInvoice, sum: "customer" })
    ).rejects.toBeInstanceOf(QueryError);
    await expect(
      raw({ from: ERPNextSalesInvoice, avg: "customer" })
    ).rejects.toBeInstanceOf(QueryError);
    await expect(
      raw({ from: ERPNextSalesInvoice, min: "customer" })
    ).rejects.toBeInstanceOf(QueryError);
    await expect(
      raw({ from: ERPNextSalesInvoice, max: "customer" })
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("rejects numeric aggregations over non numeric values", async () => {
    documents = [invoice({ grand_total: "not-a-number" })];
    await expect(
      raw({ from: ERPNextSalesInvoice, sum: "grand_total" })
    ).rejects.toBeInstanceOf(QueryError);
    await expect(
      raw({ from: ERPNextSalesInvoice, avg: "grand_total" })
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("returns distinct values", async () => {
    const values = await raw({
      from: ERPNextSalesInvoice,
      distinct: "status",
    });
    expect(values).toEqual(["Draft", "Paid"]);
  });
});

describe("ERPNextAdapter.raw grouping", () => {
  it("groups records by one attribute", async () => {
    const grouped = await raw({
      from: ERPNextSalesInvoice,
      groupBy: ["status"],
    });
    expect(Object.keys(grouped)).toEqual(["Draft", "Paid"]);
    expect(grouped.Draft).toHaveLength(2);
    expect(grouped.Paid).toHaveLength(1);
  });

  it("nests multiple group selectors and paginates groups", async () => {
    const grouped = await raw({
      from: ERPNextSalesInvoice,
      groupBy: ["status", "customer"],
    });
    expect(grouped.Draft.C1).toHaveLength(1);
    expect(grouped.Draft.C2).toHaveLength(1);

    const paged = await raw({
      from: ERPNextSalesInvoice,
      groupBy: ["status"],
      skip: 1,
      limit: 1,
    });
    expect(Object.keys(paged)).toEqual(["Paid"]);
  });

  it("normalizes undefined, null and object group keys", async () => {
    documents = [
      invoice({ name: "SINV-1", status: undefined }),
      invoice({ name: "SINV-2", status: null }),
      invoice({ name: "SINV-3", status: { tier: "gold" } }),
    ];
    const grouped = await raw({
      from: ERPNextSalesInvoice,
      groupBy: ["status"],
    });
    expect(Object.keys(grouped)).toEqual(["undefined", '{"tier":"gold"}']);
    expect(grouped.undefined).toHaveLength(2);
    expect(
      (adapter as unknown as { normalizeGroupKey: (v: unknown) => string })
        .normalizeGroupKey(Symbol("sym"))
    ).toBe("Symbol(sym)");
  });

  it("returns the input when there are no group selectors", async () => {
    const grouped = (
      adapter as unknown as {
        groupRecords: (records: unknown[], selectors: unknown[]) => unknown;
      }
    ).groupRecords([{ a: 1 }], []);
    expect(grouped).toEqual([{ a: 1 }]);
  });
});

describe("ERPNextAdapter.parseError", () => {
  it("keeps decaf errors unchanged", () => {
    const original = new ERPNextNotFoundError("missing");
    expect(adapter.parseError(original)).toBe(original);
  });

  it("maps HTTP-bearing errors through parseERPNextError", () => {
    const error = Object.assign(new Error("boom"), {
      status: 404,
      data: {},
    });
    expect(adapter.parseError(error)).toBeInstanceOf(ERPNextNotFoundError);
  });

  it("maps connection failures", () => {
    for (const message of [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "network error",
      "fetch failed",
      "aborted",
      "timeout",
    ])
      expect(adapter.parseError(new Error(message))).toBeInstanceOf(
        ERPNextConnectionError
      );
  });

  it("falls back to the base ERPNext error", () => {
    expect(adapter.parseError(new Error("weird failure"))).toBeInstanceOf(
      ERPNextError
    );
    expect(adapter.parseError(new Error("weird failure"))).toBeInstanceOf(
      InternalError
    );
  });
});

describe("ERPNextAdapter lifecycle and helpers", () => {
  it("creates unique document names through Sequence", async () => {
    const sequence = await adapter.Sequence({ name: "my seq" } as never);
    const first = await sequence.next();
    const second = await sequence.next();
    expect(first).toMatch(/^MY-SEQ-/);
    expect(second).toMatch(/^MY-SEQ-/);
    expect(first).not.toBe(second);
    expect(await sequence.current()).toMatch(/^MY-SEQ-/);
    expect(await sequence.range(3)).toHaveLength(3);
  });

  it("adds an identity UUID to the operation flags", async () => {
    const flags = await adapter.flags(OperationKeys.CREATE, ERPNextCustomer, {});
    expect(flags.UUID).toBe("tester");

    const explicit = await adapter.flags(OperationKeys.CREATE, ERPNextCustomer, {
      UUID: "custom",
    });
    expect(explicit.UUID).toBe("custom");

    const config = (adapter as unknown as { config: { username?: string } })
      .config;
    const previous = config.username;
    config.username = undefined;
    try {
      const generated = await adapter.flags(
        OperationKeys.CREATE,
        ERPNextCustomer,
        {}
      );
      expect(generated.UUID).toBeTruthy();
    } finally {
      config.username = previous;
    }
  });

  it("exposes the ERPNext lock, dispatcher, paginator and repository", () => {
    expect(adapter.transactionLock()).toBeInstanceOf(ERPNextContextLock);
    expect(
      (adapter as unknown as { Dispatch: () => unknown }).Dispatch()
    ).toBeInstanceOf(ERPNextDispatch);
    expect(
      adapter.Paginator<ERPNextCustomer>(
        { from: ERPNextCustomer } as never,
        2,
        ERPNextCustomer
      )
    ).toBeInstanceOf(ERPNextPaginator);
    expect(adapter.Statement()).toBeTruthy();
    expect(adapter.repository()).toBeTruthy();
  });

  it("recreates the client after shutdown", async () => {
    const first = adapter.client;
    await adapter.shutdown();
    const second = adapter.client;
    expect(second).not.toBe(first);
    expect(second.initialized).toBeFalsy();
  });

  it("falls back to the supplied id when reverting an empty record", () => {
    const model = adapter.revert({}, ERPNextCustomer, "PK-1", undefined, ctx);
    expect(model.name).toBe("PK-1");
    const named = adapter.revert(
      { name: "PK-2", customer_name: "ACME" },
      ERPNextCustomer,
      "PK-1",
      undefined,
      ctx
    );
    expect(named.name).toBe("PK-2");
  });
});
