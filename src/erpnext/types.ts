import type { AdapterFlags, Context } from "@decaf-ts/core";
import type { Constructor } from "@decaf-ts/decoration";
import type { Model } from "@decaf-ts/decorator-validation";

/**
 * @description HTTP verbs understood by the ERPNext transport
 * @summary The subset of HTTP methods used by the Frappe REST API.
 * @typedef {("GET"|"POST"|"PUT"|"DELETE")} ERPNextHttpMethod
 * @memberOf module:erpnext
 */
export type ERPNextHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * @description A transport-level request descriptor
 * @summary Normalized request the adapter hands to the injectable transport. The
 * default transport maps it onto `fetch`; tests and server-side wrappers can
 * substitute their own implementation without touching the adapter logic.
 * @typedef {object} ERPNextHttpRequest
 * @property {ERPNextHttpMethod} method HTTP verb
 * @property {string} url Fully-qualified request URL
 * @property {Record<string, string>} [headers] Request headers
 * @property {unknown} [data] Request body (objects are JSON encoded)
 * @property {number} [timeout] Request timeout in milliseconds
 * @memberOf module:erpnext
 */
export interface ERPNextHttpRequest {
  method: ERPNextHttpMethod;
  url: string;
  headers?: Record<string, string>;
  data?: unknown;
  timeout?: number;
}

/**
 * @description A transport-level response descriptor
 * @summary Minimal response shape. `headers` preserves the raw header map so the
 * session-login fallback can capture the `sid` cookie.
 * @typedef {object} ERPNextHttpResponse
 * @property {number} status HTTP status code
 * @property {any} data Parsed response body
 * @property {Record<string, string>} [headers] Response headers
 * @memberOf module:erpnext
 */
export interface ERPNextHttpResponse {
  status: number;
  data: any;
  headers?: Record<string, string>;
}

/**
 * @description Injectable HTTP transport
 * @summary Function that performs a single HTTP request. Supplying one keeps the
 * adapter independent of any concrete HTTP client and makes the transport fully
 * mockable in tests.
 * @typedef {function(ERPNextHttpRequest): Promise<ERPNextHttpResponse>} ERPNextTransport
 * @memberOf module:erpnext
 */
export type ERPNextTransport = (
  request: ERPNextHttpRequest
) => Promise<ERPNextHttpResponse>;

/**
 * @description Configuration accepted by {@link ERPNextAdapter}
 * @summary Authentication is injectable and never read from ambient globals.
 * Token auth (`apiKey` + `apiSecret`) takes precedence; when absent the client
 * falls back to a Frappe session login (`username` + `password`). The transport
 * is injectable so the adapter can run against a mock or a custom HTTP client.
 * @typedef {object} ERPNextConfig
 * @property {string} baseUrl Site root, e.g. `https://erp.example.com`
 * @property {string} [apiKey] Frappe API key
 * @property {string} [apiSecret] Frappe API secret
 * @property {string} [username] Session-login user (fallback)
 * @property {string} [password] Session-login password (fallback)
 * @property {string} [apiPath] Override for `/api/resource`
 * @property {string} [loginPath] Override for `/api/method/login`
 * @property {number} [timeout] Per-request timeout in milliseconds
 * @property {number} [defaultPageLength] Default list page length
 * @property {Record<string, string>} [headers] Extra headers sent on every request
 * @property {ERPNextTransport} [transport] Injectable HTTP transport
 * @memberOf module:erpnext
 */
export interface ERPNextConfig {
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  username?: string;
  password?: string;
  apiPath?: string;
  loginPath?: string;
  timeout?: number;
  defaultPageLength?: number;
  headers?: Record<string, string>;
  transport?: ERPNextTransport;
}

/**
 * @description Frappe comparison operators accepted by the list API
 * @summmary Mirrors the operators in Frappe's `filters` query parameter.
 * @typedef {string} ERPNextFilterOperator
 * @memberOf module:erpnext
 */
export type ERPNextFilterOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "like"
  | "in"
  | "between"
  | "is";

/**
 * @description A single Frappe filter row
 * @summary `[field, operator, value]` as accepted by the Frappe list API.
 * @typedef {[string, ERPNextFilterOperator, unknown]} ERPNextFilter
 * @memberOf module:erpnext
 */
export type ERPNextFilter = [string, ERPNextFilterOperator, unknown];

/**
 * @description Ordering clause for a list request
 * @typedef {object} ERPNextOrderBy
 * @property {string} field Document field
 * @property {("asc"|"desc")} direction Sort direction
 * @memberOf module:erpnext
 */
export interface ERPNextOrderBy {
  field: string;
  direction: "asc" | "desc";
}

/**
 * @description Adapter flags enriched with the acting user identity
 * @summary Extends the base adapter flags with the `UUID` field used by the
 * `createdBy`/`updatedBy` handlers.
 * @interface ERPNextFlags
 * @extends AdapterFlags
 * @memberOf module:erpnext
 */
export interface ERPNextFlags extends AdapterFlags {
  UUID?: string;
}

/**
 * @description Contextual type used by the ERPNext adapter
 * @typedef {Context<ERPNextFlags>} ERPNextContext
 * @memberOf module:erpnext
 */
export type ERPNextContext = Context<ERPNextFlags>;

/**
 * @description Raw query descriptor applied by the ERPNext adapter
 * @summary Combines the server-side Frappe list controls (`filters`, `fields`,
 * `orderBy`) with the in-memory guards (`where`, aggregations) the core
 * `Statement` contract exposes. The adapter uses the server filters as a
 * pre-filter and always evaluates `where` so complex predicates stay correct.
 * @typedef {object} RawERPNextQuery
 * @template M
 * @memberOf module:erpnext
 */
export type RawERPNextQuery<M extends Model = any> = {
  select?: (keyof M)[] | undefined;
  from: Constructor<M>;
  where?: (el: M) => boolean;
  filters?: ERPNextFilter[];
  orderBy?: ERPNextOrderBy[];
  limit?: number;
  skip?: number;
  extent?: number;
  groupBy?: (keyof M)[];
  count?: keyof M | null;
  countDistinct?: keyof M;
  min?: keyof M;
  max?: keyof M;
  sum?: keyof M;
  avg?: keyof M;
  distinct?: keyof M;
};
