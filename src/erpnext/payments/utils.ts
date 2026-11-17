import { ConnectionError } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import {
  ERPNextPaymentDefaultCurrency,
  ERPNextPaymentIntervals,
  ERPNextPaymentZeroDecimalCurrencies,
} from "./constants";
import { ERPNextPaymentError } from "./errors";
import type {
  ERPNextPaymentHttpRequest,
  ERPNextPaymentHttpResponse,
  ERPNextPaymentInterval,
  ERPNextPaymentTransport,
} from "./types";

/**
 * @description Creates a fetch-based payment transport
 * @summary Returns a transport that issues provider requests with `globalThis.fetch`, JSON-encodes object bodies, applies timeouts and converts failures into {@link ConnectionError}.
 * @function createERPNextPaymentFetchTransport
 * @memberOf module:erpnext/payments
 */
export function createERPNextPaymentFetchTransport(): ERPNextPaymentTransport {
  return async (
    request: ERPNextPaymentHttpRequest
  ): Promise<ERPNextPaymentHttpResponse> => {
    if (typeof globalThis.fetch !== "function")
      throw new ERPNextPaymentError(
        "The runtime has no global fetch. Provide ERPNextPaymentProviderConfig.transport."
      );

    const controller = new AbortController();
    const timer =
      typeof request.timeout === "number" && request.timeout > 0
        ? setTimeout(() => controller.abort(), request.timeout)
        : undefined;
    const headers: Record<string, string> = { ...(request.headers ?? {}) };
    let body: any;
    const data = request.data;
    if (typeof data !== "undefined") {
      if (
        typeof data === "string" ||
        data instanceof URLSearchParams ||
        data instanceof FormData
      ) {
        body = data;
      } else {
        body = JSON.stringify(data);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type"))
          headers["content-type"] = "application/json";
      }
    }

    try {
      const response = await globalThis.fetch(request.url, {
        method: request.method,
        headers,
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: any = text;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      } else {
        payload = undefined;
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      return {
        status: response.status,
        data: payload,
        headers: responseHeaders,
      };
    } catch (e: unknown) {
      if (e instanceof ValidationError || e instanceof ConnectionError) throw e;
      if (e instanceof Error && /aborted|abort/i.test(e.message))
        throw new ConnectionError(
          `Payment provider request timed out: ${request.url}`
        );
      throw new ConnectionError(e as Error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

function appendFormValue(
  search: URLSearchParams,
  name: string,
  value: unknown
): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      appendFormValue(search, `${name}[${index}]`, entry)
    );
    return;
  }
  if (value instanceof Date) {
    search.append(name, value.toISOString());
    return;
  }
  if (typeof value === "object") {
    toPaymentFormBody(value as Record<string, unknown>, name, search);
    return;
  }
  search.append(name, String(value));
}

/**
 * @description Encodes a record as a form-url-encoded payload
 * @summary Serializes nested objects, arrays and dates using bracket notation for providers that expect form bodies.
 * @function toPaymentFormBody
 * @memberOf module:erpnext/payments
 */
export function toPaymentFormBody(
  input: Record<string, unknown>,
  prefix?: string,
  search: URLSearchParams = new URLSearchParams()
): URLSearchParams {
  for (const [key, value] of Object.entries(input)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    appendFormValue(search, name, value);
  }
  return search;
}

/**
 * @description Parses and validates a payment amount
 * @summary Accepts numbers or numeric strings and throws {@link ValidationError} unless the value is a positive finite number.
 * @function parsePaymentAmount
 * @memberOf module:erpnext/payments
 */
export function parsePaymentAmount(amount: number | string): number {
  const parsed = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new ValidationError(
      `Payment amount must be a positive finite number, got ${String(amount)}`
    );
  return parsed;
}

/**
 * @description Converts an amount to provider minor units
 * @summary Multiplies by 100 except for zero-decimal currencies such as JPY.
 * @function toMinorUnits
 * @memberOf module:erpnext/payments
 */
export function toMinorUnits(
  amount: number | string,
  currency: string = ERPNextPaymentDefaultCurrency
): number {
  const parsed = parsePaymentAmount(amount);
  const normalized = String(currency || ERPNextPaymentDefaultCurrency)
    .trim()
    .toUpperCase();
  if (ERPNextPaymentZeroDecimalCurrencies.has(normalized))
    return Math.round(parsed);
  return Math.round(parsed * 100);
}

/**
 * @description Converts provider minor units back to a major amount
 * @summary Divides by 100 except for zero-decimal currencies.
 * @function fromMinorUnits
 * @memberOf module:erpnext/payments
 */
export function fromMinorUnits(
  amount: number,
  currency: string = ERPNextPaymentDefaultCurrency
): number {
  const normalized = String(currency || ERPNextPaymentDefaultCurrency)
    .trim()
    .toUpperCase();
  if (ERPNextPaymentZeroDecimalCurrencies.has(normalized)) return amount;
  return amount / 100;
}

/**
 * @description Normalizes a billing interval
 * @summary Matches the value case-insensitively against the supported intervals and defaults to `Month`.
 * @function normalizePaymentInterval
 * @memberOf module:erpnext/payments
 */
export function normalizePaymentInterval(
  interval?: string | null
): ERPNextPaymentInterval {
  if (!interval) return "Month";
  const match = ERPNextPaymentIntervals.find(
    (candidate) => candidate.toLowerCase() === interval.toLowerCase()
  );
  if (!match)
    throw new ValidationError(
      `Unsupported payment interval "${interval}". Use one of ${ERPNextPaymentIntervals.join(", ")}`
    );
  return match;
}

/**
 * @description Returns the lower-case billing interval unit
 * @summary Convenience wrapper around {@link normalizePaymentInterval} for provider payloads.
 * @function paymentIntervalUnit
 * @memberOf module:erpnext/payments
 */
export function paymentIntervalUnit(
  interval?: string | null
): "day" | "week" | "month" | "year" {
  return normalizePaymentInterval(interval).toLowerCase() as
    | "day"
    | "week"
    | "month"
    | "year";
}

/**
 * @description Removes undefined entries from a record
 * @summary Returns a copy of the input without keys whose value is `undefined`.
 * @function compactPaymentRecord
 * @memberOf module:erpnext/payments
 */
export function compactPaymentRecord(
  input: Record<string, unknown>
): Record<string, any> {
  return Object.entries(input).reduce(
    (accum, [key, value]) => {
      if (typeof value !== "undefined") accum[key] = value;
      return accum;
    },
    {} as Record<string, any>
  );
}

/**
 * @description Base64-encodes a JSON payload
 * @summary Serializes a value to JSON and base64-encodes it, for providers that require signed base64 payloads.
 * @function paymentBase64Json
 * @memberOf module:erpnext/payments
 */
export function paymentBase64Json(value: unknown): string {
  const json = JSON.stringify(value);
  const encoded = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
  const runtime = globalThis as unknown as {
    btoa?: (input: string) => string;
  };
  if (typeof runtime.btoa !== "function")
    throw new ERPNextPaymentError(
      "This runtime does not expose btoa; provide a signed parameter payload through a custom transport."
    );
  return runtime.btoa(encoded);
}
