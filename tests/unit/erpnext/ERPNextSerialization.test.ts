/**
 * @module integrations/tests/unit/erpnext/ERPNextSerialization
 * @summary SAA-1690 regressions for ERPNext boolean revival and Frappe datetime
 * precision across the repository merged-update path.
 * @description These tests lock the behaviour repaired under SAA-1688: design-typed
 * `boolean` attributes are revived from Frappe's `0/1` wire format and encoded back
 * as `0/1`, and the raw `modified` datetime (including microseconds) survives a
 * `repo.read` -> `repo.update(readModel)` round-trip instead of being re-formatted
 * to whole seconds, which Frappe rejects as a stale document. The HTTP transport is
 * injected, so no ERPNext site is required.
 */
import { it } from "@decaf-ts/for-testing";
import { beforeAll, beforeEach, describe, expect } from "@jest/globals";
import { Repository } from "@decaf-ts/core";
import {
  ERPNextAdapter,
  ERPNextCustomer,
  ERPNextFlavour,
  ERPNextRepository,
  formatERPNextDateTime,
  parseERPNextDate,
  reviveERPNextRecord,
  serializeERPNextRecord,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

const RAW_MODIFIED = "2026-11-17 04:53:42.117624";

const documents: Record<string, any> = {
  "CUST-1": {
    name: "CUST-1",
    customer_name: "ACME",
    customer_type: "Company",
    disabled: 0,
    creation: RAW_MODIFIED,
    modified: RAW_MODIFIED,
  },
};

const calls: ERPNextHttpRequest[] = [];

function validationError(exception: string): ERPNextHttpResponse {
  return {
    status: 417,
    data: { exc_type: "ValidationError", exception },
  };
}

const transport: ERPNextTransport = async (request) => {
  calls.push(request);
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/resource/Customer/CUST-1")
    return { status: 200, data: { data: { ...documents["CUST-1"] } } };
  if (request.method === "PUT" && path === "/api/resource/Customer/CUST-1") {
    const body = (request.data ?? {}) as Record<string, any>;
    const current = documents["CUST-1"];
    if (body.modified !== current.modified)
      return validationError(
        `Document has been modified after you have opened it (${current.modified}, ${body.modified}). Please refresh and try again.`
      );
    if (body.disabled !== 0 && body.disabled !== 1)
      return validationError(
        `disabled - Invalid type. Expected Boolean, received ${typeof body.disabled}`
      );
    documents["CUST-1"] = {
      ...current,
      ...body,
      modified: "2026-11-17 05:10:00.222333",
    };
    return { status: 200, data: { data: { ...documents["CUST-1"] } } };
  }
  return { status: 404, data: { exc_type: "DoesNotExistError" } };
};

let adapter: ERPNextAdapter;
let customerRepo: ERPNextRepository<ERPNextCustomer>;

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
  customerRepo = Repository.forModel(
    ERPNextCustomer
  ) as ERPNextRepository<ERPNextCustomer>;
});

beforeEach(() => {
  calls.length = 0;
});

describe("ERPNext boolean revival", () => {
  it("revives numeric, boolean and string wire forms into real booleans", () => {
    const cases: Array<[unknown, boolean]> = [
      [0, false],
      [1, true],
      [false, false],
      [true, true],
      ["0", false],
      ["1", true],
      ["false", false],
      ["true", true],
    ];
    for (const [raw, expected] of cases) {
      const revived = reviveERPNextRecord(
        { name: "CUST-1", disabled: raw },
        ERPNextCustomer
      );
      expect(revived.disabled).toBe(expected);
      expect(typeof revived.disabled).toBe("boolean");
    }
  });

  it("leaves values outside Frappe's boolean wire format untouched", () => {
    const untouched = reviveERPNextRecord(
      { name: "CUST-1", disabled: 2 },
      ERPNextCustomer
    );
    expect(untouched.disabled).toBe(2);
  });

  it("encodes booleans back as Frappe's native 1/0", () => {
    expect(serializeERPNextRecord({ disabled: true }).disabled).toBe(1);
    expect(serializeERPNextRecord({ disabled: false }).disabled).toBe(0);
  });
});

describe("ERPNext datetime precision", () => {
  it("round-trips the raw Frappe datetime including microseconds", () => {
    const parsed = parseERPNextDate(RAW_MODIFIED);
    expect(parsed).toBeInstanceOf(Date);
    expect(formatERPNextDateTime(parsed!)).toBe(RAW_MODIFIED);
  });

  it("falls back to whole-second formatting when the Date is mutated", () => {
    const parsed = parseERPNextDate(RAW_MODIFIED)!;
    parsed.setTime(parsed.getTime() + 1000);
    const formatted = formatERPNextDateTime(parsed);
    expect(formatted).not.toBe(RAW_MODIFIED);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("ERPNext repository merged update", () => {
  it("updates a read model through repo.update(readModel)", async () => {
    const read = await customerRepo.read("CUST-1");
    expect(read).toBeInstanceOf(ERPNextCustomer);
    expect(typeof read.disabled).toBe("boolean");
    expect(read.disabled).toBe(false);
    expect(read.modified).toBeInstanceOf(Date);

    read.customer_name = "ACME Updated";
    const updated = await customerRepo.update(read);

    expect(updated).toBeInstanceOf(ERPNextCustomer);
    expect(updated.customer_name).toBe("ACME Updated");
    expect(typeof updated.disabled).toBe("boolean");

    const put = calls.find((call) => call.method === "PUT");
    expect(put).toBeTruthy();
    const body = put!.data as Record<string, any>;
    expect(body.customer_name).toBe("ACME Updated");
    expect(body.disabled).toBe(0);
    expect(body.modified).toBe(RAW_MODIFIED);
  });

  it("serializes a changed boolean as 1/0 through the merged update", async () => {
    const read = await customerRepo.read("CUST-1");
    read.disabled = true;

    const updated = await customerRepo.update(read);
    expect(updated.disabled).toBe(true);

    const put = calls.find((call) => call.method === "PUT");
    expect(put).toBeTruthy();
    expect((put!.data as Record<string, any>).disabled).toBe(1);
  });
});
