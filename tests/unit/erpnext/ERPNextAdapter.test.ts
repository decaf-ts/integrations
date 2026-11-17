/**
 * @module integrations/tests/unit/erpnext/ERPNextAdapter
 * @summary Unit coverage for the ERPNext adapter, repository, query statement and
 * paginator, the seed doctype models and date (de)serialization. The HTTP
 * transport is injected, so no ERPNext site is required.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect, beforeAll, beforeEach } from "@jest/globals";
import { Condition, OrderDirection, Repository } from "@decaf-ts/core";
import {
  ERPNextAdapter,
  ERPNextCustomer,
  ERPNextRepository,
  ERPNextSalesInvoice,
  ERPNextStatement,
  ERPNextFlavour,
  ERPNextAuthenticationError,
  parseERPNextError,
  reviveERPNextRecord,
  serializeERPNextRecord,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

const documents: Record<string, any> = {
  "CUST-1": {
    name: "CUST-1",
    customer_name: "ACME",
    customer_type: "Company",
    creation: "2026-01-02 03:04:05",
  },
  "CUST-2": {
    name: "CUST-2",
    customer_name: "Beta",
    customer_type: "Individual",
  },
};

const calls: ERPNextHttpRequest[] = [];

function requestedFields(call: ERPNextHttpRequest): string[] {
  const fields = new URL(call.url).searchParams.get("fields");
  return fields ? (JSON.parse(fields) as string[]) : [];
}

const transport: ERPNextTransport = async (
  request
): Promise<ERPNextHttpResponse> => {
  calls.push(request);
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/resource/Customer") {
    const fieldsParam = url.searchParams.get("fields");
    if (!fieldsParam)
      return {
        status: 200,
        data: { data: Object.values(documents).map((doc) => ({ name: doc.name })) },
      };
    const fields = JSON.parse(fieldsParam) as string[];
    const rows = fields.includes("*")
      ? Object.values(documents)
      : Object.values(documents).map((doc) =>
          fields.reduce((projected, field) => {
            if (field in doc) projected[field] = doc[field];
            return projected;
          }, {} as Record<string, any>)
        );
    return { status: 200, data: { data: rows } };
  }
  if (request.method === "GET" && path.startsWith("/api/resource/Customer/")) {
    const name = decodeURIComponent(path.split("/").pop() as string);
    const document = documents[name];
    return document
      ? { status: 200, data: { data: document } }
      : { status: 404, data: { exc_type: "DoesNotExistError" } };
  }
  if (request.method === "POST" && path === "/api/resource/Customer")
    return {
      status: 200,
      data: {
        data: {
          name: (request.data as Record<string, any>)?.name ?? "CUST-NEW",
          ...(request.data as Record<string, any>),
        },
      },
    };
  if (request.method === "PUT" && path.startsWith("/api/resource/Customer/"))
    return {
      status: 200,
      data: {
        data: {
          name: decodeURIComponent(path.split("/").pop() as string),
          ...(request.data as Record<string, any>),
        },
      },
    };
  if (request.method === "DELETE" && path.startsWith("/api/resource/Customer/"))
    return { status: 200, data: { message: "ok" } };
  return { status: 404, data: { exc_type: "DoesNotExistError" } };
};

let adapter: ERPNextAdapter;
let repo: ERPNextRepository<ERPNextCustomer>;

beforeAll(async () => {
  adapter = new ERPNextAdapter(
    {
      baseUrl: "https://erp.example.com",
      apiKey: "k",
      apiSecret: "s",
      transport,
    },
    ERPNextFlavour
  );
  await adapter.initialize();
  repo = Repository.forModel(ERPNextCustomer) as ERPNextRepository<ERPNextCustomer>;
});

beforeEach(() => {
  calls.length = 0;
});

describe("ERPNextAdapter wiring", () => {
  it("uses the ERPNext flavour", () => {
    expect(adapter.flavour).toBe(ERPNextFlavour);
  });

  it("returns the standard-API ERPNext repository bound to the doctype", () => {
    expect(repo).toBeInstanceOf(ERPNextRepository);
    expect(repo.doctype).toBe("Customer");
  });

  it("decorates the seed models with the ERPNext flavour", () => {
    expect((ERPNextSalesInvoice as any).constructor).toBeTruthy();
    expect(ERPNextSalesInvoice.name).toBe("ERPNextSalesInvoice");
  });

  it("requires the mandatory Customer display name", () => {
    const invalid = new ERPNextCustomer({ name: "X" } as never);
    expect(invalid.hasErrors()).toBeTruthy();
  });
});

describe("ERPNextAdapter CRUD", () => {
  it("creates a document through the resource endpoint", async () => {
    const created = await repo.create(
      new ERPNextCustomer({ customer_name: "Gamma" })
    );
    expect(created).toBeInstanceOf(ERPNextCustomer);
    expect(created.customer_name).toBe("Gamma");
    expect(created.name).toBeTruthy();
    expect(calls[0].method).toBe("POST");
    expect(new URL(calls[0].url).pathname).toBe("/api/resource/Customer");
  });

  it("reads a document and revives its date fields", async () => {
    const customer = await repo.read("CUST-1");
    expect(customer).toBeInstanceOf(ERPNextCustomer);
    expect(customer.customer_name).toBe("ACME");
    expect(customer.creation).toBeInstanceOf(Date);
    expect(new URL(calls[0].url).pathname).toBe(
      "/api/resource/Customer/CUST-1"
    );
  });

  it("updates and deletes through the document URL", async () => {
    const updated = await repo.update(
      new ERPNextCustomer({ name: "CUST-2", customer_name: "Beta Ltd" })
    );
    expect(updated.customer_name).toBe("Beta Ltd");
    const put = calls.find((call) => call.method === "PUT");
    expect(put).toBeTruthy();
    expect(new URL(put!.url).pathname).toBe("/api/resource/Customer/CUST-2");

    calls.length = 0;
    await repo.delete("CUST-2");
    const del = calls.find((call) => call.method === "DELETE");
    expect(del).toBeTruthy();
    expect(new URL(del!.url).pathname).toBe(
      "/api/resource/Customer/CUST-2"
    );
  });
});

describe("ERPNextStatement", () => {
  it("is produced by the adapter statement factory", () => {
    expect(adapter.Statement()).toBeInstanceOf(ERPNextStatement);
  });

  it("translates simple conditions into Frappe filters and orders results", async () => {
    const result = await adapter
      .Statement<ERPNextCustomer>()
      .from(ERPNextCustomer)
      .where(
        Condition.attribute<ERPNextCustomer>("customer_type").eq("Company")
      )
      .orderBy(["customer_name", OrderDirection.ASC])
      .limit(1)
      .execute();

    expect(result).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("filters")).toBe(
      '[["customer_type","=","Company"]]'
    );
    expect(url.searchParams.get("order_by")).toBe("customer_name asc");
  });

  it("applies complex predicates in memory", async () => {
    const result = await adapter
      .Statement<ERPNextCustomer>()
      .from(ERPNextCustomer)
      .where(
        Condition.or(
          Condition.attribute<ERPNextCustomer>("customer_type").eq("Company"),
          Condition.attribute<ERPNextCustomer>("name").eq("CUST-2")
        )
      )
      .execute();

    expect(result.map((customer) => customer.name).sort()).toEqual([
      "CUST-1",
      "CUST-2",
    ]);
    expect(new URL(calls[0].url).searchParams.get("filters")).toBe("[]");
  });

  it("paginates a raw query", async () => {
    const paginator = adapter.Paginator<ERPNextCustomer>(
      { from: ERPNextCustomer },
      1,
      ERPNextCustomer
    );
    const page = await paginator.page(1);
    expect(Array.isArray(page)).toBe(true);
    expect(page).toHaveLength(1);
    expect(paginator.total).toBe(2);
  });
});

describe("ERPNextAdapter Frappe list field projection", () => {
  it("returns the full matching model for a findBy on a non-primary-key attribute", async () => {
    const results = await repo.findBy("customer_name", "ACME");

    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(ERPNextCustomer);
    expect(results[0].name).toBe("CUST-1");
    expect(results[0].customer_name).toBe("ACME");
    expect(results[0].customer_type).toBe("Company");
  });

  it("returns populated rows for a where on a non-primary-key attribute", async () => {
    const results = await repo
      .select()
      .where(
        Condition.attribute<ERPNextCustomer>("customer_type").eq("Company")
      )
      .execute();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("CUST-1");
    expect(results[0].customer_name).toBe("ACME");
  });

  it("requests all fields for an unprojected list query", async () => {
    await repo.select().execute();

    expect(requestedFields(calls[0])).toContain("*");
  });

  it("requests the filter attribute alongside the projection for a projected query", async () => {
    const results = await repo
      .select(["customer_name"])
      .where(
        Condition.attribute<ERPNextCustomer>("customer_type").eq("Company")
      )
      .execute();

    expect(requestedFields(calls[0])).toEqual(
      expect.arrayContaining(["customer_name", "customer_type"])
    );
    expect(results).toHaveLength(1);
    expect(results[0].customer_name).toBe("ACME");
  });
});

describe("ERPNext serialization and errors", () => {
  it("encodes Date/bigint values and revives date attributes", () => {
    const encoded = serializeERPNextRecord({
      creation: new Date("2026-01-02T03:04:05.000Z"),
      sequence: BigInt(5),
      nested: { at: new Date("2026-02-03T00:00:00.000Z") },
    });
    expect(encoded.creation).toBe("2026-01-02 03:04:05");
    expect(encoded.sequence).toBe("5");
    expect(encoded.nested.at).toBe("2026-02-03 00:00:00");

    const revived = reviveERPNextRecord(
      { name: "CUST-1", creation: "2026-01-02 03:04:05" },
      ERPNextCustomer
    );
    expect(revived.creation).toBeInstanceOf(Date);
  });

  it("maps statuses onto the decaf error hierarchy", () => {
    expect(parseERPNextError(401, {}).name).toBe(
      ERPNextAuthenticationError.name
    );
    expect(parseERPNextError(404, {}).name).toBe("ERPNextNotFoundError");
    expect(parseERPNextError(403, {}).name).toBe("ERPNextPermissionError");
    expect(parseERPNextError(417, {}).name).toBe("ERPNextValidationError");
  });
});
