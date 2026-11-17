/**
 * @module integrations/tests/unit/erpnext/ERPNextClient
 * @summary Unit coverage for the ERPNext REST client: token auth, session-login
 * fallback, response unwrapping, query serialization and error normalization.
 * The HTTP transport is injected, so no network access is performed.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import {
  ERPNextAuthenticationError,
  ERPNextClient,
  ERPNextConflictError,
  ERPNextNotFoundError,
  ERPNextPermissionError,
  ERPNextValidationError,
} from "../../../src/erpnext";
import type {
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextTransport,
} from "../../../src/erpnext";

type Handler = (
  request: ERPNextHttpRequest
) => Promise<ERPNextHttpResponse> | ERPNextHttpResponse;

function transportOf(handler: Handler): {
  transport: ERPNextTransport;
  calls: ERPNextHttpRequest[];
} {
  const calls: ERPNextHttpRequest[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push(request);
      return handler(request);
    },
  };
}

function pathAndQuery(request: ERPNextHttpRequest) {
  const url = new URL(request.url);
  return {
    path: url.pathname,
    params: url.searchParams,
  };
}

describe("ERPNextClient", () => {
  it("rejects a configuration without any credentials", async () => {
    const client = new ERPNextClient({ baseUrl: "https://erp.example.com" });
    await expect(client.initialize()).rejects.toBeInstanceOf(
      ERPNextAuthenticationError
    );
  });

  it("uses token authentication when apiKey/apiSecret are configured", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { data: [] },
    }));
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com",
      apiKey: "key",
      apiSecret: "secret",
      transport,
    });
    await client.initialize();
    expect(client.initialized).toBe(true);
    expect(client.usesTokenAuth).toBe(true);

    await client.listDocs("Customer");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers?.authorization).toBe("token key:secret");
  });

  it("falls back to a session login and reuses the sid cookie", async () => {
    const { transport, calls } = transportOf((request) => {
      if (request.url.endsWith("/api/method/login"))
        return {
          status: 200,
          data: { message: "Logged In" },
          headers: { "set-cookie": "sid=abc123; Path=/; HttpOnly" },
        };
      return { status: 200, data: { data: [] } };
    });
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com/",
      username: "admin",
      password: "admin",
      transport,
    });
    await client.initialize();
    expect(client.usesTokenAuth).toBe(false);

    await client.listDocs("Customer");
    expect(calls[0].url).toBe("https://erp.example.com/api/method/login");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].data).toBeInstanceOf(URLSearchParams);
    expect((calls[0].data as URLSearchParams).toString()).toBe(
      "usr=admin&pwd=admin"
    );
    expect(calls[1].headers?.cookie).toBe("sid=abc123");
  });

  it("serializes Frappe list controls and unwraps the data envelope", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { data: [{ name: "CUST-1" }] },
    }));
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com",
      apiKey: "k",
      apiSecret: "s",
      transport,
    });

    const documents = await client.listDocs("Sales Invoice", {
      filters: [["status", "=", "Paid"]],
      fields: ["name", "status"],
      orderBy: [{ field: "posting_date", direction: "desc" }],
      limitStart: 20,
      limitPageLength: 10,
    });

    expect(documents).toEqual([{ name: "CUST-1" }]);
    const { path, params } = pathAndQuery(calls[0]);
    expect(path).toBe("/api/resource/Sales%20Invoice");
    expect(params.get("filters")).toBe('[["status","=","Paid"]]');
    expect(params.get("fields")).toBe('["name","status"]');
    expect(params.get("order_by")).toBe("posting_date desc");
    expect(params.get("limit_start")).toBe("20");
    expect(params.get("limit_page_length")).toBe("10");
  });

  it("maps HTTP failures onto the decaf ERPNext error hierarchy", async () => {
    const cases: Array<[number, unknown, any]> = [
      [404, { exc_type: "DoesNotExistError" }, ERPNextNotFoundError],
      [403, { exc_type: "PermissionError" }, ERPNextPermissionError],
      [417, { exc_type: "ValidationError" }, ERPNextValidationError],
      [409, { exc_type: "DuplicateEntryError" }, ERPNextConflictError],
    ];

    for (const [status, body, errorType] of cases) {
      const { transport } = transportOf(() => ({ status, data: body }));
      const client = new ERPNextClient({
        baseUrl: "https://erp.example.com",
        apiKey: "k",
        apiSecret: "s",
        transport,
      });
      await expect(client.getDoc("Customer", "missing")).rejects.toBeInstanceOf(
        errorType as never
      );
    }
  });

  it("extracts the message from Frappe _server_messages", async () => {
    const { transport } = transportOf(() => ({
      status: 417,
      data: {
        exc_type: "ValidationError",
        _server_messages: JSON.stringify([
          JSON.stringify({ message: "Customer Name is mandatory" }),
        ]),
      },
    }));
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com",
      apiKey: "k",
      apiSecret: "s",
      transport,
    });
    await expect(client.createDoc("Customer", {})).rejects.toMatchObject({
      message: expect.stringContaining("Customer Name is mandatory"),
    });
  });

  it("calls Frappe server methods through the method endpoint", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { message: { ok: true } },
    }));
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com",
      apiKey: "k",
      apiSecret: "s",
      transport,
    });
    const result = await client.callMethod("erpnext.utilities.ping", {
      value: 1,
    });
    expect(result).toEqual({ ok: true });
    expect(pathAndQuery(calls[0]).path).toBe(
      "/api/method/erpnext/utilities/ping"
    );
    expect(calls[0].data).toEqual({ value: 1 });
  });

  it("encodes dot-separated method segments", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { message: { ok: true } },
    }));
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com",
      apiKey: "k",
      apiSecret: "s",
      transport,
    });
    await client.callMethod("x.y");
    expect(pathAndQuery(calls[0]).path).toBe("/api/method/x/y");
  });

  it("does not allow hostile callMethod input to alter the path", async () => {
    const { transport, calls } = transportOf(() => ({
      status: 200,
      data: { message: { ok: true } },
    }));
    const client = new ERPNextClient({
      baseUrl: "https://erp.example.com",
      apiKey: "k",
      apiSecret: "s",
      transport,
    });

    await client.callMethod("../../api/resource/Customer");
    const traversal = pathAndQuery(calls[0]).path;
    expect(traversal.startsWith("/api/method/")).toBe(true);
    expect(traversal).not.toContain("..");
    expect(traversal).not.toBe("/api/resource/Customer");
    expect(traversal).not.toContain("/api/resource/Customer");

    await client.callMethod("a/b");
    const slash = pathAndQuery(calls[1]).path;
    expect(slash).toBe("/api/method/a%2Fb");
    expect(slash.startsWith("/api/method/")).toBe(true);
    expect(slash.split("/").filter(Boolean)).toHaveLength(3);
  });
});
