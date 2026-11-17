/**
 * @module integrations/tests/unit/erpnext/ERPNextReportService
 * @summary Unit coverage for the ERPNext report model service. The adapter
 * transport is injected and Frappe method/resource envelopes are mocked, so no
 * ERPNext site, network or credentials are required.
 */
import { it } from "@decaf-ts/for-testing";
import { beforeAll, beforeEach, describe, expect } from "@jest/globals";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextAdapter,
  ERPNextFlavour,
  ERPNextReport,
  ERPNextReportService,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

const reports: Record<string, any>[] = [
  {
    name: "Sales Register",
    report_name: "Sales Register",
    ref_doctype: "Sales Invoice",
    is_standard: "No",
    report_type: "Query Report",
  },
  {
    name: "Purchase Register",
    report_name: "Purchase Register",
    ref_doctype: "Purchase Invoice",
    is_standard: "No",
    report_type: "Query Report",
  },
];

const calls: ERPNextHttpRequest[] = [];

function pathOf(call: ERPNextHttpRequest): string {
  return decodeURIComponent(new URL(call.url).pathname);
}

const transport: ERPNextTransport = async (
  request: ERPNextHttpRequest
): Promise<ERPNextHttpResponse> => {
  calls.push(request);
  const path = pathOf(request);
  if (
    request.method === "POST" &&
    path === "/api/method/frappe.desk.query_report.run"
  ) {
    return {
      status: 200,
      data: {
        message: {
          columns: [
            { fieldname: "customer", label: "Customer", fieldtype: "Link" },
            { fieldname: "grand_total", label: "Grand Total", fieldtype: "Currency" },
          ],
          result: [
            ["ACME", 100],
            ["Beta", 50],
          ],
          report_summary: [{ label: "Total", value: 150 }],
        },
      },
    };
  }
  if (request.method === "GET" && path === "/api/resource/Report") {
    const url = new URL(request.url);
    const filters = JSON.parse(url.searchParams.get("filters") ?? "[]");
    const refDoctype = Array.isArray(filters) && filters[0] ? filters[0][2] : undefined;
    const rows = refDoctype
      ? reports.filter((report) => report.ref_doctype === refDoctype)
      : reports;
    return { status: 200, data: { data: rows } };
  }
  return { status: 404, data: { exc_type: "DoesNotExistError" } };
};

describe("ERPNextReportService", () => {
  let service: ERPNextReportService;

  beforeAll(async () => {
    const adapter = new ERPNextAdapter(
      {
        baseUrl: "https://erp.example.com",
        apiKey: "key",
        apiSecret: "secret",
        transport,
      },
      ERPNextFlavour
    );
    await adapter.initialize();
    service = new ERPNextReportService();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("runs a report and maps the columns and result", async () => {
    const result = await service.run(
      new ERPNextReport({
        name: "Sales Register",
        report_name: "Sales Register",
        ref_doctype: "Sales Invoice",
        is_standard: "No",
        report_type: "Query Report",
      }),
      { filters: { company: "ACME" } }
    );

    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].fieldname).toBe("customer");
    expect(result.result).toHaveLength(2);
    expect(result.result[0]).toEqual(["ACME", 100]);
    expect(result.report_summary).toEqual([{ label: "Total", value: 150 }]);

    const post = calls.find(
      (call) =>
        call.method === "POST" &&
        pathOf(call) === "/api/method/frappe.desk.query_report.run"
    );
    expect(post).toBeTruthy();
    const body = post!.data as Record<string, any>;
    expect(body.report_name).toBe("Sales Register");
    expect(body.filters).toEqual({ company: "ACME" });
    expect(body.ignore_prepared_report).toBe(false);
    expect(body.are_default_filters).toBe(false);
  });

  it("runs a report by name and forwards the run options", async () => {
    await service.run("Sales Register", {
      ignorePreparedReport: true,
      areDefaultFilters: true,
    });

    const body = calls[0].data as Record<string, any>;
    expect(body.report_name).toBe("Sales Register");
    expect(body.ignore_prepared_report).toBe(true);
    expect(body.are_default_filters).toBe(true);
  });

  it("requires a report name to run", async () => {
    await expect(service.run(new ERPNextReport({}))).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("lists the reports registered for a doctype", async () => {
    const result = await service.listForDoctype("Sales Invoice");

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(ERPNextReport);
    expect(result[0].report_name).toBe("Sales Register");
    expect(result[0].ref_doctype).toBe("Sales Invoice");

    const url = new URL(calls[0].url);
    expect(decodeURIComponent(url.pathname)).toBe("/api/resource/Report");
    expect(url.searchParams.get("filters")).toBe(
      '[["ref_doctype","=","Sales Invoice"]]'
    );
  });
});
