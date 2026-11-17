/**
 * @module integrations/tests/unit/erpnext/ERPNextClientTransport
 * @summary SAA-1689: unit coverage for the default `frappe-js-sdk` transport of
 * {@link ERPNextClient}. The SDK is mocked at the module boundary so the tests
 * verify the app construction, the axios request mapping, token and session
 * authentication, cookie handling, envelope unwrapping, query serialization and
 * decaf error normalization without any network access.
 * @description `frappe-js-sdk` is replaced with `jest.unstable_mockModule`; the
 * fake `FrappeApp` exposes `axios.request`, records every request and answers
 * through a per-test responder. The client is imported dynamically after the
 * mock is installed so the real SDK never loads.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect, jest, beforeAll, beforeEach } from "@jest/globals";
import { BadRequestError, ValidationError } from "@decaf-ts/db-decorators";
import type {
  ERPNextHttpRequest,
  ERPNextTransport,
} from "../../../src/erpnext";

interface SdkRequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
  timeout?: number;
  validateStatus?: (status: number) => boolean;
}

interface SdkResponse {
  status: number;
  data?: unknown;
  headers?: Record<string, unknown>;
}

interface SdkTokenParams {
  useToken?: boolean;
  token?: () => string;
  type?: string;
}

interface MockFrappeAppInstance {
  url: string;
  name: string;
  tokenParams?: SdkTokenParams;
  customHeaders?: Record<string, string>;
  axios: { request(config: SdkRequestConfig): Promise<SdkResponse> };
}

let sdkInstances: MockFrappeAppInstance[] = [];
let sdkRequests: SdkRequestConfig[] = [];
let sdkResponder: (
  config: SdkRequestConfig
) => SdkResponse | Promise<SdkResponse> = () => {
  throw new Error("no SDK responder configured");
};

function resetSdk(): void {
  sdkInstances = [];
  sdkRequests = [];
  sdkResponder = () => {
    throw new Error("no SDK responder configured");
  };
}

jest.unstable_mockModule("frappe-js-sdk", () => {
  class MockFrappeApp {
    readonly url: string;
    readonly name: string;
    readonly tokenParams?: SdkTokenParams;
    readonly customHeaders?: Record<string, string>;
    readonly axios: MockFrappeAppInstance["axios"];

    constructor(
      url: string,
      tokenParams?: SdkTokenParams,
      name?: string,
      customHeaders?: Record<string, string>
    ) {
      this.url = url;
      this.name = name ?? "FrappeApp";
      this.tokenParams = tokenParams;
      this.customHeaders = customHeaders;
      this.axios = {
        request: async (config: SdkRequestConfig) => {
          sdkRequests.push(config);
          return sdkResponder(config);
        },
      };
      sdkInstances.push(this);
    }
  }

  return { FrappeApp: MockFrappeApp };
});

type ClientModule = typeof import("../../../src/erpnext");

let ERPNextClient: ClientModule["ERPNextClient"];
let ERPNextAuthenticationError: ClientModule["ERPNextAuthenticationError"];
let ERPNextConnectionError: ClientModule["ERPNextConnectionError"];
let ERPNextConflictError: ClientModule["ERPNextConflictError"];
let ERPNextError: ClientModule["ERPNextError"];
let ERPNextNotFoundError: ClientModule["ERPNextNotFoundError"];
let ERPNextPermissionError: ClientModule["ERPNextPermissionError"];
let ERPNextUnsupportedError: ClientModule["ERPNextUnsupportedError"];
let ERPNextValidationError: ClientModule["ERPNextValidationError"];

beforeAll(async () => {
  ({
    ERPNextClient,
    ERPNextAuthenticationError,
    ERPNextConnectionError,
    ERPNextConflictError,
    ERPNextError,
    ERPNextNotFoundError,
    ERPNextPermissionError,
    ERPNextUnsupportedError,
    ERPNextValidationError,
  } = await import("../../../src/erpnext"));
});

beforeEach(resetSdk);

const baseUrl = "https://erp.example.com";

function tokenClient(
  overrides: Partial<ConstructorParameters<ClientModule["ERPNextClient"]>[0]> = {}
): InstanceType<ClientModule["ERPNextClient"]> {
  return new ERPNextClient({
    baseUrl,
    apiKey: "key",
    apiSecret: "secret",
    ...overrides,
  });
}

function sessionClient(
  overrides: Partial<ConstructorParameters<ClientModule["ERPNextClient"]>[0]> = {}
): InstanceType<ClientModule["ERPNextClient"]> {
  return new ERPNextClient({
    baseUrl,
    username: "admin",
    password: "admin123",
    ...overrides,
  });
}

function singleRequest(): SdkRequestConfig {
  expect(sdkRequests).toHaveLength(1);
  return sdkRequests[0];
}

function queryOf(config: SdkRequestConfig): URL {
  return new URL(config.url);
}

describe("ERPNextClient frappe-js-sdk transport (SAA-1689)", () => {
  it("constructs FrappeApp with the site URL, token params, client name and headers", () => {
    tokenClient({ headers: { "x-tenant": "acme" } });

    expect(sdkInstances).toHaveLength(1);
    const app = sdkInstances[0];
    expect(app.url).toBe(baseUrl);
    expect(app.name).toBe("decaf-erpnext");
    expect(app.customHeaders).toEqual({ "x-tenant": "acme" });
    expect(app.tokenParams?.useToken).toBe(true);
    expect(app.tokenParams?.type).toBe("token");
    expect(app.tokenParams?.token?.()).toBe("key:secret");
  });

  it("constructs FrappeApp without token auth when only session credentials exist", () => {
    sessionClient();

    expect(sdkInstances).toHaveLength(1);
    expect(sdkInstances[0].tokenParams?.useToken).toBe(false);
    expect(sdkInstances[0].tokenParams?.type).toBe("token");
  });

  it("sends token-auth list requests through axios with the full Frappe query", async () => {
    sdkResponder = () => ({
      status: 200,
      data: { data: [{ name: "CUST-1" }] },
    });
    const client = tokenClient();

    const records = await client.listDocs("Sales Invoice", {
      filters: [
        ["status", "=", "Paid"],
        ["customer", "like", "%ACME%"],
      ],
      fields: ["name", "customer", "grand_total"],
      orderBy: [
        { field: "creation", direction: "desc" },
        { field: "name", direction: "asc" },
      ],
      limitStart: 40,
      limitPageLength: 20,
    });

    expect(records).toEqual([{ name: "CUST-1" }]);
    const config = singleRequest();
    expect(config.method).toBe("GET");
    expect(typeof config.validateStatus).toBe("function");
    expect(config.validateStatus?.(500)).toBe(true);
    expect(config.headers?.authorization).toBe("token key:secret");
    expect(config.timeout).toBe(30000);

    const url = queryOf(config);
    expect(url.pathname).toBe("/api/resource/Sales%20Invoice");
    expect(url.searchParams.get("filters")).toBe(
      '[["status","=","Paid"],["customer","like","%ACME%"]]'
    );
    expect(url.searchParams.get("fields")).toBe(
      '["name","customer","grand_total"]'
    );
    expect(url.searchParams.get("order_by")).toBe(
      "creation desc, name asc"
    );
    expect(url.searchParams.get("limit_start")).toBe("40");
    expect(url.searchParams.get("limit_page_length")).toBe("20");
  });

  it("defaults the page length and omits unset list parameters", async () => {
    sdkResponder = () => ({ status: 200, data: { data: [] } });
    const client = tokenClient();

    await client.listDocs("Customer");

    const url = queryOf(singleRequest());
    expect(url.pathname).toBe("/api/resource/Customer");
    expect(url.searchParams.get("filters")).toBe("[]");
    expect(url.searchParams.get("limit_page_length")).toBe("20");
    expect(url.searchParams.has("fields")).toBe(false);
    expect(url.searchParams.has("order_by")).toBe(false);
    expect(url.searchParams.has("limit_start")).toBe(false);
  });

  it("counts documents through the bounded name projection", async () => {
    sdkResponder = () => ({
      status: 200,
      data: { data: [{ name: "a" }, { name: "b" }] },
    });
    const client = tokenClient();

    await expect(
      client.countDocs("Customer", [["status", "=", "Draft"]])
    ).resolves.toBe(2);

    const url = queryOf(singleRequest());
    expect(url.searchParams.get("fields")).toBe('["name"]');
    expect(url.searchParams.get("limit_page_length")).toBe("0");
    expect(url.searchParams.get("filters")).toBe('[["status","=","Draft"]]');
  });

  it("maps CRUD verbs and bodies onto the axios instance", async () => {
    sdkResponder = () => ({
      status: 200,
      data: { data: { name: "CUST-1" } },
    });
    const client = tokenClient();

    await client.getDoc("Customer", "CUST-1");
    await client.createDoc("Customer", { customer_name: "ACME" });
    await client.updateDoc("Customer", "CUST-1", { customer_name: "ACME 2" });
    await client.deleteDoc("Customer", "CUST-1");

    expect(sdkRequests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
      "PUT",
      "DELETE",
    ]);
    expect(new URL(sdkRequests[0].url).pathname).toBe(
      "/api/resource/Customer/CUST-1"
    );
    expect(new URL(sdkRequests[1].url).pathname).toBe(
      "/api/resource/Customer"
    );
    expect(sdkRequests[1].data).toEqual({ customer_name: "ACME" });
    expect(sdkRequests[2].data).toEqual({ customer_name: "ACME 2" });
  });

  it("unwraps data and message envelopes and passes raw bodies through", async () => {
    const client = tokenClient();

    sdkResponder = () => ({
      status: 200,
      data: { data: { name: "CUST-1", customer_name: "ACME" } },
    });
    await expect(client.getDoc("Customer", "CUST-1")).resolves.toEqual({
      name: "CUST-1",
      customer_name: "ACME",
    });

    sdkResponder = () => ({
      status: 200,
      data: { message: { ok: true } },
    });
    await expect(client.callMethod("erpnext.utilities.ping")).resolves.toEqual({
      ok: true,
    });

    sdkResponder = () => ({
      status: 200,
      data: { name: "CUST-1", raw: true },
    });
    await expect(client.getDoc("Customer", "CUST-1")).resolves.toEqual({
      name: "CUST-1",
      raw: true,
    });
  });

  it("normalizes scalar and object list payloads", async () => {
    const client = tokenClient();

    sdkResponder = () => ({ status: 200, data: { data: 5 } });
    await expect(client.listDocs("Customer")).resolves.toEqual([]);

    sdkResponder = () => ({
      status: 200,
      data: { data: { name: "CUST-1" } },
    });
    await expect(client.listDocs("Customer")).resolves.toEqual([
      { name: "CUST-1" },
    ]);
  });

  it("posts form-encoded session credentials and reuses the sid cookie", async () => {
    sdkResponder = (config) =>
      config.url.endsWith("/api/method/login")
        ? {
            status: 200,
            data: { message: "Logged In" },
            headers: { "set-cookie": "sid=abc123; Path=/; HttpOnly" },
          }
        : { status: 200, data: { data: [] } };
    const client = sessionClient();

    await client.initialize();
    await client.listDocs("Customer");

    expect(sdkRequests).toHaveLength(2);
    const login = sdkRequests[0];
    expect(login.method).toBe("POST");
    expect(new URL(login.url).pathname).toBe("/api/method/login");
    expect(login.headers?.["content-type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(login.headers?.authorization).toBeUndefined();
    expect(login.data).toBeInstanceOf(URLSearchParams);
    const form = login.data as URLSearchParams;
    expect(form.get("usr")).toBe("admin");
    expect(form.get("pwd")).toBe("admin123");

    const list = sdkRequests[1];
    expect(list.headers?.cookie).toBe("sid=abc123");
    expect(list.headers?.authorization).toBeUndefined();
  });

  it("extracts the sid cookie from an array-valued set-cookie header", async () => {
    sdkResponder = (config) =>
      config.url.endsWith("/api/method/login")
        ? {
            status: 200,
            data: { message: "Logged In" },
            headers: {
              "set-cookie": ["foo=bar; Path=/", "sid=xyz789; Path=/"],
            },
          }
        : { status: 200, data: { data: [] } };
    const client = sessionClient();

    await client.initialize();
    await client.listDocs("Customer");

    expect(sdkRequests[1].headers?.cookie).toBe("sid=xyz789");
  });

  it("clears the session cookie after a 401 so the next call is anonymous", async () => {
    let resourceCalls = 0;
    sdkResponder = (config) => {
      if (config.url.endsWith("/api/method/login"))
        return {
          status: 200,
          data: { message: "Logged In" },
          headers: { "set-cookie": "sid=abc123; Path=/" },
        };
      resourceCalls += 1;
      if (resourceCalls === 1) return { status: 401, data: {} };
      return { status: 200, data: { data: { name: "CUST-1" } } };
    };
    const client = sessionClient();

    await client.initialize();
    await expect(client.getDoc("Customer", "CUST-1")).rejects.toBeInstanceOf(
      ERPNextAuthenticationError
    );
    await expect(client.getDoc("Customer", "CUST-1")).resolves.toEqual({
      name: "CUST-1",
    });

    const failed = sdkRequests[1];
    const retried = sdkRequests[2];
    expect(failed.headers?.cookie).toBe("sid=abc123");
    expect(retried.headers?.cookie).toBeUndefined();
  });

  it("wraps SDK/network failures as ERPNextConnectionError", async () => {
    sdkResponder = () => {
      throw new Error("ECONNREFUSED 127.0.0.1:443");
    };
    const client = tokenClient();

    await expect(client.listDocs("Customer")).rejects.toBeInstanceOf(
      ERPNextConnectionError
    );
  });

  it("rethrows decaf errors from the SDK unchanged", async () => {
    const original = new ValidationError("invalid payload");
    sdkResponder = () => {
      throw original;
    };
    const client = tokenClient();

    await expect(client.createDoc("Customer", {})).rejects.toBe(original);
  });

  it("maps HTTP error bodies to the decaf ERPNext error classes", async () => {
    const client = tokenClient();

    const cases: Array<{
      status: number;
      body?: unknown;
      expected: new (...args: never[]) => Error;
      message?: string;
    }> = [
      { status: 400, body: { message: "Bad Request" }, expected: BadRequestError },
      { status: 401, body: {}, expected: ERPNextAuthenticationError },
      { status: 403, body: {}, expected: ERPNextPermissionError },
      { status: 404, body: {}, expected: ERPNextNotFoundError },
      { status: 409, body: {}, expected: ERPNextConflictError },
      { status: 422, body: {}, expected: ERPNextValidationError },
      { status: 405, body: {}, expected: ERPNextUnsupportedError },
      { status: 500, body: { message: "boom" }, expected: ERPNextError },
      { status: 503, body: {}, expected: ERPNextConnectionError },
      {
        status: 400,
        body: { exc_type: "ValidationError", message: "Mandatory field" },
        expected: ERPNextValidationError,
        message: "Mandatory field",
      },
      {
        status: 417,
        body: {
          _server_messages: JSON.stringify([
            JSON.stringify({ message: "Invalid account" }),
          ]),
        },
        expected: ERPNextValidationError,
        message: "Invalid account",
      },
    ];

    for (const testCase of cases) {
      sdkResponder = () => ({ status: testCase.status, data: testCase.body });
      const error = await client
        .listDocs("Customer")
        .then(() => undefined)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(testCase.expected);
      if (testCase.message)
        expect((error as Error).message).toContain(testCase.message);
      expect(
        sdkRequests.at(-1)?.validateStatus?.(testCase.status)
      ).toBe(true);
    }
  });

  it("uses a custom ERPNextConfig.transport instead of the SDK axios instance", async () => {
    const requests: ERPNextHttpRequest[] = [];
    const transport: ERPNextTransport = async (request) => {
      requests.push(request);
      return { status: 200, data: { data: [{ name: "CUST-1" }] } };
    };
    const client = tokenClient({ transport });

    await expect(client.listDocs("Customer")).resolves.toEqual([
      { name: "CUST-1" },
    ]);

    expect(sdkRequests).toHaveLength(0);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/resource/Customer");
    expect(request.headers?.authorization).toBe("token key:secret");
  });
});
