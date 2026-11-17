/**
 * @module integrations/tests/unit/erpnext/payments/utils
 * @summary Unit coverage for the ERPNext payment helpers: minor-unit conversion,
 * form encoding, interval normalization, record compaction, base64 payloads,
 * the fetch transport and the payment-provider error hierarchy mapping.
 */
import { it } from "@decaf-ts/for-testing";
import { afterEach, describe, expect } from "@jest/globals";
import { ConnectionError, UnsupportedError } from "@decaf-ts/core";
import { BadRequestError, ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextPaymentAuthenticationError,
  ERPNextPaymentConflictError,
  ERPNextPaymentError,
  ERPNextPaymentForbiddenError,
  ERPNextPaymentNotFoundError,
  ERPNextPaymentProviderError,
  compactPaymentRecord,
  createERPNextPaymentFetchTransport,
  fromMinorUnits,
  normalizePaymentInterval,
  parsePaymentProviderError,
  paymentBase64Json,
  paymentIntervalUnit,
  paymentProviderErrorMessage,
  toMinorUnits,
  toPaymentFormBody,
} from "../../../../src/erpnext";

const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

function fakeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {}
): Response {
  return {
    status,
    text: async () => body,
    headers: {
      forEach: (callback: (value: string, key: string) => void) =>
        Object.entries(headers).forEach(([key, value]) =>
          callback(value, key)
        ),
    },
  } as unknown as Response;
}

describe("payment amount helpers", () => {
  it("converts EUR amounts to and from cents", () => {
    expect(toMinorUnits(10, "EUR")).toBe(1000);
    expect(toMinorUnits("12.34", "eur")).toBe(1234);
    expect(toMinorUnits(0.1, "EUR")).toBe(10);
    expect(fromMinorUnits(1000, "EUR")).toBe(10);
    expect(fromMinorUnits(1234, "eur")).toBe(12.34);
  });

  it("keeps zero-decimal currencies unchanged", () => {
    expect(toMinorUnits(10, "JPY")).toBe(10);
    expect(toMinorUnits("12.4", "jpy")).toBe(12);
    expect(fromMinorUnits(100, "JPY")).toBe(100);
  });

  it("defaults to EUR when no currency is supplied", () => {
    expect(toMinorUnits(3)).toBe(300);
    expect(fromMinorUnits(300)).toBe(3);
  });

  it("rejects non-positive and non-finite amounts", () => {
    for (const amount of [0, -1, "-2", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toMinorUnits(amount as number)).toThrow(ValidationError);
    }
  });
});

describe("payment form encoding", () => {
  it("flattens nested objects and arrays and skips null/undefined", () => {
    const body = toPaymentFormBody({
      amount: 1000,
      currency: "EUR",
      nested: { key: "value" },
      list: ["a", "b"],
      when: new Date("2026-01-02T03:04:05.000Z"),
      empty: null,
      missing: undefined,
    });

    expect(body.get("amount")).toBe("1000");
    expect(body.get("currency")).toBe("EUR");
    expect(body.get("nested[key]")).toBe("value");
    expect(body.get("list[0]")).toBe("a");
    expect(body.get("list[1]")).toBe("b");
    expect(body.get("when")).toBe("2026-01-02T03:04:05.000Z");
    expect(body.has("empty")).toBe(false);
    expect(body.has("missing")).toBe(false);
  });

  it("supports an explicit prefix", () => {
    const body = toPaymentFormBody({ amount: 100 }, "payment");
    expect(body.get("payment[amount]")).toBe("100");
  });
});

describe("payment interval helpers", () => {
  it("normalizes supported intervals and defaults to Month", () => {
    expect(normalizePaymentInterval()).toBe("Month");
    expect(normalizePaymentInterval(null)).toBe("Month");
    expect(normalizePaymentInterval("year")).toBe("Year");
    expect(normalizePaymentInterval("WEEK")).toBe("Week");
    expect(paymentIntervalUnit("Month")).toBe("month");
  });

  it("rejects unsupported intervals with a decaf ValidationError", () => {
    expect(() => normalizePaymentInterval("Fortnight")).toThrow(
      ValidationError
    );
  });
});

describe("payment record helpers", () => {
  it("drops undefined members but keeps null and false", () => {
    expect(
      compactPaymentRecord({ a: 1, b: undefined, c: null, d: false })
    ).toEqual({ a: 1, c: null, d: false });
  });

  it("encodes JSON as base64 for Redsys merchant parameters", () => {
    const encoded = paymentBase64Json({ amount: "100", nested: { a: 1 } });
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    );
    expect(decoded).toEqual({ amount: "100", nested: { a: 1 } });
  });
});

describe("createERPNextPaymentFetchTransport", () => {
  it("serializes JSON payloads and parses JSON responses", async () => {
    let seen: RequestInit | undefined;
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      seen = init;
      return fakeResponse(200, JSON.stringify({ id: "pi_1" }), {
        "x-request-id": "req-1",
      });
    };
    const transport = createERPNextPaymentFetchTransport();
    const response = await transport({
      method: "POST",
      url: "https://payments.example.com/charge",
      headers: { authorization: "Bearer token" },
      data: { amount: 100 },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ id: "pi_1" });
    expect(response.headers?.["x-request-id"]).toBe("req-1");
    expect(seen?.method).toBe("POST");
    expect((seen?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
    expect(seen?.body).toBe(JSON.stringify({ amount: 100 }));
  });

  it("passes URLSearchParams through and preserves non-JSON text bodies", async () => {
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(URLSearchParams);
      return fakeResponse(200, "plain text");
    };
    const transport = createERPNextPaymentFetchTransport();
    const response = await transport({
      method: "POST",
      url: "https://payments.example.com/charge",
      data: new URLSearchParams({ a: "1" }),
    });
    expect(response.data).toBe("plain text");
  });

  it("returns undefined for an empty response body", async () => {
    (globalThis as any).fetch = async () => fakeResponse(204, "");
    const transport = createERPNextPaymentFetchTransport();
    const response = await transport({
      method: "GET",
      url: "https://payments.example.com/charge",
    });
    expect(response.data).toBeUndefined();
  });

  it("wraps network failures in a decaf ConnectionError", async () => {
    (globalThis as any).fetch = async () => {
      throw new Error("socket hang up");
    };
    const transport = createERPNextPaymentFetchTransport();
    await expect(
      transport({ method: "GET", url: "https://payments.example.com" })
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it("reports a missing global fetch with a decaf payment error", async () => {
    delete (globalThis as any).fetch;
    const transport = createERPNextPaymentFetchTransport();
    await expect(
      transport({ method: "GET", url: "https://payments.example.com" })
    ).rejects.toBeInstanceOf(ERPNextPaymentError);
  });
});

describe("parsePaymentProviderError", () => {
  it("maps HTTP statuses onto the decaf error hierarchy", () => {
    expect(parsePaymentProviderError("stripe", 401)).toBeInstanceOf(
      ERPNextPaymentAuthenticationError
    );
    expect(parsePaymentProviderError("stripe", 403)).toBeInstanceOf(
      ERPNextPaymentForbiddenError
    );
    expect(parsePaymentProviderError("stripe", 404)).toBeInstanceOf(
      ERPNextPaymentNotFoundError
    );
    expect(parsePaymentProviderError("stripe", 409)).toBeInstanceOf(
      ERPNextPaymentConflictError
    );
    expect(parsePaymentProviderError("stripe", 400)).toBeInstanceOf(
      ERPNextPaymentProviderError
    );
    expect(parsePaymentProviderError("stripe", 422)).toBeInstanceOf(
      ERPNextPaymentProviderError
    );
    for (const status of [408, 429, 500, 502, 503]) {
      expect(parsePaymentProviderError("stripe", status)).toBeInstanceOf(
        ConnectionError
      );
    }
    expect(parsePaymentProviderError("stripe", 418)).toBeInstanceOf(
      ERPNextPaymentError
    );
  });

  it("extracts provider messages from nested payloads", () => {
    expect(paymentProviderErrorMessage('{"error":{"message":"bad key"}}')).toBe(
      "bad key"
    );
    expect(paymentProviderErrorMessage([{ detail: "first" }])).toBe("first");
    expect(paymentProviderErrorMessage(undefined)).toBeUndefined();
    expect(
      parsePaymentProviderError("sibs", 400, { message: "invalid merchant" })
    ).toMatchObject({ message: expect.stringContaining("invalid merchant") });
  });

  it("never rewraps an existing decaf error", () => {
    const original = new ValidationError("already decaf");
    expect(parsePaymentProviderError("stripe", 500, original)).toBe(original);
  });

  it("keeps the decaf payment hierarchy rooted in BaseError subclasses", () => {
    expect(parsePaymentProviderError("bizum", 401)).toBeInstanceOf(Error);
    expect(
      parsePaymentProviderError("gocardless", 400, "card declined")
    ).toBeInstanceOf(BadRequestError);
    expect(parsePaymentProviderError("sibs", 501)).not.toBeInstanceOf(
      UnsupportedError
    );
  });
});
