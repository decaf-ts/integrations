/**
 * @module integrations/tests/unit/erpnext/ERPNextChartOfAccountsService
 * @summary Unit coverage for the ERPNext chart-of-accounts model service. The
 * adapter transport is injected and the Frappe Account resource envelope is
 * mocked, so no ERPNext site, network or credentials are required.
 */
import { it } from "@decaf-ts/for-testing";
import { beforeAll, beforeEach, describe, expect } from "@jest/globals";
import {
  ERPNextAccount,
  ERPNextAdapter,
  ERPNextChartOfAccountsService,
  ERPNextFlavour,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

const accounts: Record<string, any>[] = [
  {
    name: "Assets",
    account_name: "Assets",
    company: "ACME",
    parent_account: "All Accounts",
    root_type: "Asset",
    is_group: true,
  },
  {
    name: "Current Assets",
    account_name: "Current Assets",
    company: "ACME",
    parent_account: "Assets",
    root_type: "Asset",
    is_group: true,
  },
  {
    name: "Cash",
    account_name: "Cash",
    company: "ACME",
    parent_account: "Current Assets",
    account_type: "Cash",
  },
  {
    name: "Liabilities",
    account_name: "Liabilities",
    company: "ACME",
    parent_account: "All Accounts",
    root_type: "Liability",
    is_group: true,
  },
  {
    name: "Other Company Cash",
    account_name: "Other Company Cash",
    company: "OTHER",
    parent_account: "All Accounts",
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
  if (request.method === "GET" && pathOf(request) === "/api/resource/Account") {
    const url = new URL(request.url);
    const filters = JSON.parse(url.searchParams.get("filters") ?? "[]");
    const company = Array.isArray(filters) && filters[0] ? filters[0][2] : undefined;
    const rows = company
      ? accounts.filter((account) => account.company === company)
      : accounts;
    return { status: 200, data: { data: rows } };
  }
  return { status: 404, data: { exc_type: "DoesNotExistError" } };
};

describe("ERPNextChartOfAccountsService", () => {
  let service: ERPNextChartOfAccountsService;

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
    service = new ERPNextChartOfAccountsService();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("lists the accounts of a company", async () => {
    const result = await service.listForCompany("ACME");

    expect(result).toHaveLength(4);
    expect(result[0]).toBeInstanceOf(ERPNextAccount);
    expect(result.every((account) => account.company === "ACME")).toBe(true);

    const url = new URL(calls[0].url);
    expect(decodeURIComponent(url.pathname)).toBe("/api/resource/Account");
    expect(url.searchParams.get("filters")).toBe('[["company","=","ACME"]]');
  });

  it("builds the parent/child account tree", async () => {
    const roots = await service.tree("ACME");

    expect(roots).toHaveLength(2);
    expect(roots.map((node) => node.account)).toEqual(["Assets", "Liabilities"]);

    const assets = roots[0];
    expect(assets.children).toHaveLength(1);
    expect(assets.children?.[0].account).toBe("Current Assets");
    expect(assets.children?.[0].children?.[0].account).toBe("Cash");
    expect(assets.children?.[0].children?.[0].account_name).toBe("Cash");

    const liabilities = roots[1];
    expect(liabilities.children).toBeUndefined();
  });

  it("flattens the tree in pre-order", async () => {
    const flattened = await service.flatten("ACME");

    expect(flattened.map((node) => node.account)).toEqual([
      "Assets",
      "Current Assets",
      "Cash",
      "Liabilities",
    ]);
  });
});
