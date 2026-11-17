import { FrappeApp } from "frappe-js-sdk";
import {
  ERPNextDefaultApiPath,
  ERPNextDefaultPageLength,
  ERPNextDefaultTimeout,
  ERPNextDocumentIdField,
  ERPNextLoginPath,
} from "./constants";
import {
  ERPNextAuthenticationError,
  ERPNextConnectionError,
  parseERPNextError,
} from "./errors";
import type {
  ERPNextConfig,
  ERPNextFilter,
  ERPNextHttpMethod,
  ERPNextHttpRequest,
  ERPNextHttpResponse,
  ERPNextOrderBy,
  ERPNextTransport,
} from "./types";
import { BaseError } from "@decaf-ts/db-decorators";

/**
 * @description Options accepted by one ERPNext REST request
 * @summary Query parameters, body and per-request header overrides.
 * @typedef {object} ERPNextRequestOptions
 * @property {Record<string, unknown>} [params] Query parameters
 * @property {unknown} [data] Request body
 * @property {Record<string, string>} [headers] Header overrides
 * @memberOf module:erpnext
 */
export interface ERPNextRequestOptions {
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * @description Options accepted by a list request
 * @summary Mirrors the Frappe `/api/resource/{doctype}` list controls.
 * @typedef {object} ERPNextListOptions
 * @property {ERPNextFilter[]} [filters] Frappe filter rows
 * @property {string[]} [fields] Fields to return
 * @property {ERPNextOrderBy[]} [orderBy] Ordering clauses
 * @property {number} [limitStart] Offset (`limit_start`)
 * @property {number} [limitPageLength] Page length (`limit_page_length`, 0 = all)
 * @memberOf module:erpnext
 */
export interface ERPNextListOptions {
  filters?: ERPNextFilter[];
  fields?: string[];
  orderBy?: ERPNextOrderBy[];
  limitStart?: number;
  limitPageLength?: number;
}

/**
 * @description Thin ERPNext (Frappe) REST client
 * @summary Encapsulates authentication and the `/api/resource` document API. Token
 * authentication (`token api_key:api_secret`) is preferred; when only a username
 * and password are configured it falls back to a Frappe session login and reuses
 * the resulting `sid` cookie. Every failure is normalized through
 * {@link parseERPNextError} into the decaf error hierarchy.
 * @class ERPNextClient
 * @memberOf module:erpnext
 */
export class ERPNextClient {
  private readonly transport?: ERPNextTransport;
  private readonly app: FrappeApp;
  private readonly baseUrl: string;
  private readonly apiPath: string;
  private readonly loginPath: string;
  private readonly timeout: number;
  private readonly pageLength: number;
  private _initialized = false;
  private _cookie?: string;

  /**
   * @description Creates a client bound to a site configuration
   * @param {ERPNextConfig} config - The site and authentication configuration
   */
  constructor(private readonly config: ERPNextConfig) {
    if (!config.baseUrl)
      throw new ERPNextAuthenticationError(
        "ERPNextConfig.baseUrl is required"
      );
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiPath = config.apiPath ?? ERPNextDefaultApiPath;
    this.loginPath = config.loginPath ?? ERPNextLoginPath;
    this.timeout = config.timeout ?? ERPNextDefaultTimeout;
    this.pageLength = config.defaultPageLength ?? ERPNextDefaultPageLength;
    this.transport = config.transport;
    this.app = this.createApp();
  }

  /**
   * @description Builds the Frappe SDK application instance
   * @summary Configures `frappe-js-sdk` with the resolved base URL, optional token
   * authentication and the configured default headers.
   * @return {FrappeApp} The configured Frappe SDK application
   */
  private createApp(): FrappeApp {
    const token = this.usesTokenAuth
      ? {
          useToken: true,
          token: () => `${this.config.apiKey}:${this.config.apiSecret}`,
          type: "token" as const,
        }
      : { useToken: false, type: "token" as const };
    return new FrappeApp(
      this.baseUrl,
      token,
      "decaf-erpnext",
      this.config.headers
    );
  }

  /**
   * @description Whether the client already authenticated
   * @return {boolean} True once authentication (token or session) succeeded
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * @description Whether the client authenticates with a Frappe API token
   * @return {boolean} True when both the API key and secret are configured
   */
  get usesTokenAuth(): boolean {
    return !!this.config.apiKey && !!this.config.apiSecret;
  }

  /**
   * @description Authenticates the client
   * @summary Selects token authentication when both API credentials are present;
   * otherwise performs a Frappe session login with the configured username and
   * password. Calling it again is a no-op once authenticated.
   * @return {Promise<void>} A promise that resolves once authentication is ready
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    if (this.usesTokenAuth) {
      this._initialized = true;
      return;
    }
    if (!this.config.username || !this.config.password)
      throw new ERPNextAuthenticationError(
        "ERPNext requires either apiKey/apiSecret or username/password"
      );
    await this.login(this.config.username, this.config.password);
    this._initialized = true;
  }

  /**
   * @description Performs a Frappe session login
   * @summary Posts `usr`/`pwd` as form data to `/api/method/login` and stores the
   * `sid` cookie returned by the site so subsequent requests are authenticated.
   * @param {string} username - The Frappe user
   * @param {string} password - The Frappe password
   * @return {Promise<void>} A promise that resolves once the session cookie is stored
   */
  async login(username: string, password: string): Promise<void> {
    const request: ERPNextHttpRequest = {
      method: "POST",
      url: this.absoluteUrl(this.loginPath),
      headers: {
        ...(this.config.headers ?? {}),
        "content-type": "application/x-www-form-urlencoded",
      },
      data: new URLSearchParams({ usr: username, pwd: password }),
      timeout: this.timeout,
    };
    const response = await this.execute(request);
    const cookie = this.extractCookie(response);
    if (cookie) this._cookie = cookie;
    this._initialized = true;
  }

  /**
   * @description Lists documents of a doctype
   * @summary Calls `GET /api/resource/{doctype}` with the Frappe `filters`,
   * `fields`, `order_by`, `limit_start` and `limit_page_length` query parameters
   * and returns the unwrapped document array.
   * @param {string} doctype - The ERPNext doctype
   * @param {ERPNextListOptions} [options] - List controls
   * @return {Promise<Record<string, any>[]>} The matching documents
   */
  async listDocs(
    doctype: string,
    options: ERPNextListOptions = {}
  ): Promise<Record<string, any>[]> {
    const params: Record<string, unknown> = {
      filters: JSON.stringify(options.filters ?? []),
      limit_page_length: options.limitPageLength ?? this.pageLength,
    };
    if (options.fields) params.fields = JSON.stringify(options.fields);
    if (options.orderBy && options.orderBy.length)
      params.order_by = options.orderBy
        .map((clause) => `${clause.field} ${clause.direction}`)
        .join(", ");
    if (typeof options.limitStart === "number")
      params.limit_start = options.limitStart;
    const body = await this.request("GET", this.resourcePath(doctype), {
      params,
    });
    return this.toArray(body);
  }

  /**
   * @description Counts documents of a doctype
   * @summary Requests only the `name` field for the matching filters and returns
   * the result length. Frappe does not expose a portable count endpoint, so this
   * is a bounded projection rather than a full document read.
   * @param {string} doctype - The ERPNext doctype
   * @param {ERPNextFilter[]} [filters] - Frappe filter rows
   * @return {Promise<number>} The number of matching documents
   */
  async countDocs(
    doctype: string,
    filters: ERPNextFilter[] = []
  ): Promise<number> {
    const records = await this.listDocs(doctype, {
      filters,
      fields: [ERPNextDocumentIdField],
      limitPageLength: 0,
    });
    return records.length;
  }

  /**
   * @description Reads a single document
   * @param {string} doctype - The ERPNext doctype
   * @param {string} name - The document name (primary key)
   * @return {Promise<Record<string, any>>} The document
   */
  async getDoc(
    doctype: string,
    name: string
  ): Promise<Record<string, any>> {
    const body = await this.request(
      "GET",
      this.resourcePath(doctype, name)
    );
    return this.toObject(body);
  }

  /**
   * @description Creates a document
   * @param {string} doctype - The ERPNext doctype
   * @param {Record<string, any>} data - The document payload
   * @return {Promise<Record<string, any>>} The created document
   */
  async createDoc(
    doctype: string,
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const body = await this.request("POST", this.resourcePath(doctype), {
      data,
    });
    return this.toObject(body);
  }

  /**
   * @description Updates a document
   * @param {string} doctype - The ERPNext doctype
   * @param {string} name - The document name (primary key)
   * @param {Record<string, any>} data - The changed fields
   * @return {Promise<Record<string, any>>} The updated document
   */
  async updateDoc(
    doctype: string,
    name: string,
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const body = await this.request(
      "PUT",
      this.resourcePath(doctype, name),
      { data }
    );
    return this.toObject(body);
  }

  /**
   * @description Deletes a document
   * @param {string} doctype - The ERPNext doctype
   * @param {string} name - The document name (primary key)
   * @return {Promise<Record<string, any>>} The deleted document payload
   */
  async deleteDoc(
    doctype: string,
    name: string
  ): Promise<Record<string, any>> {
    const body = await this.request(
      "DELETE",
      this.resourcePath(doctype, name)
    );
    return this.toObject(body);
  }

  /**
   * @description Calls an arbitrary Frappe server method
   * @summary Posts to `/api/method/{method}`; used for site utilities and custom
   * integrations that are not plain doctype CRUD. Leading slashes are stripped and
   * each dot-separated segment is `encodeURIComponent`-encoded then joined with
   * `/`. Dots are the legal Frappe method separator; slashes, `..`, `?`, `#` and
   * `%2F` cannot alter the request path structure.
   * @param {string} method - The dotted Frappe method name
   * @param {unknown} [data] - The request payload
   * @param {Record<string, unknown>} [params] - Extra query parameters
   * @return {Promise<any>} The unwrapped method result
   */
  async callMethod(
    method: string,
    data?: unknown,
    params?: Record<string, unknown>
  ): Promise<any> {
    const path = method
      .replace(/^\/+/, "")
      .split(".")
      .map(encodeURIComponent)
      .join("/");
    return this.request("POST", `/api/method/${path}`, { data, params });
  }

  /**
   * @description Builds the resource path for a doctype or document
   * @param {string} doctype - The ERPNext doctype
   * @param {string} [name] - The document name
   * @return {string} The encoded resource path
   */
  resourcePath(doctype: string, name?: string): string {
    const base = `${this.apiPath}/${encodeURIComponent(doctype)}`;
    return name ? `${base}/${encodeURIComponent(name)}` : base;
  }

  /**
   * @description Builds an absolute URL from a path
   * @param {string} path - The path, starting with `/`
   * @return {string} The absolute URL
   */
  absoluteUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /**
   * @description Executes an authenticated request
   * @summary Ensures authentication, merges headers, serializes query parameters
   * and normalizes non-2xx responses. A 401 during a session-authenticated call
   * clears the stored cookie so the next call re-authenticates.
   * @param {ERPNextHttpMethod} method - The HTTP verb
   * @param {string} path - The request path
   * @param {ERPNextRequestOptions} [options] - Request options
   * @return {Promise<any>} The unwrapped response body
   */
  private async request(
    method: ERPNextHttpMethod,
    path: string,
    options: ERPNextRequestOptions = {}
  ): Promise<any> {
    await this.initialize();
    const query = this.toQueryString(options.params);
    const url = `${this.absoluteUrl(path)}${query}`;
    const request: ERPNextHttpRequest = {
      method,
      url,
      headers: {
        ...(this.config.headers ?? {}),
        ...this.authHeaders(),
        ...(options.headers ?? {}),
      },
      data: options.data,
      timeout: this.timeout,
    };
    const response = await this.execute(request);
    return this.unwrap(response);
  }

  /**
   * @description Executes the transport and normalizes failures
   * @param {ERPNextHttpRequest} request - The request to execute
   * @return {Promise<ERPNextHttpResponse>} The raw response
   */
  private async execute(
    request: ERPNextHttpRequest
  ): Promise<ERPNextHttpResponse> {
    let response: ERPNextHttpResponse;
    try {
      response = this.transport
        ? await this.transport(request)
        : await this.sdkRequest(request);
    } catch (e: unknown) {
      if (e instanceof BaseError) throw e;
      throw new ERPNextConnectionError(e as Error);
    }
    if (response.status >= 400) {
      if (response.status === 401) this._cookie = undefined;
      throw parseERPNextError(response.status, response.data);
    }
    return response;
  }

  /**
   * @description Performs a request through the Frappe SDK transport
   * @summary Maps the normalized request onto the SDK axios instance and converts
   * the response into the adapter's {@link ERPNextHttpResponse} shape without
   * throwing on HTTP error statuses.
   * @param {ERPNextHttpRequest} request - The normalized request
   * @return {Promise<ERPNextHttpResponse>} The normalized response
   */
  private async sdkRequest(
    request: ERPNextHttpRequest
  ): Promise<ERPNextHttpResponse> {
    const response = await this.app.axios.request({
      url: request.url,
      method: request.method,
      headers: request.headers,
      data: request.data,
      timeout: request.timeout,
      validateStatus: () => true,
    });
    return {
      status: response.status,
      data: response.data,
      headers: this.normalizeHeaders(response.headers),
    };
  }

  /**
   * @description Normalizes response headers into a lower-case string map
   * @summary Accepts both plain header objects and axios header instances (via
   * `toJSON`) and flattens array values.
   * @param {unknown} headers - The raw response headers
   * @return {Record<string, string>} The normalized header map
   */
  private normalizeHeaders(headers: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) return result;
    const source =
      typeof (headers as { toJSON?: () => Record<string, unknown> }).toJSON ===
      "function"
        ? (headers as { toJSON: () => Record<string, unknown> }).toJSON()
        : (headers as Record<string, unknown>);
    for (const [key, value] of Object.entries(source ?? {})) {
      if (Array.isArray(value)) result[key.toLowerCase()] = value as never;
      else if (value !== undefined && value !== null)
        result[key.toLowerCase()] = String(value);
    }
    return result;
  }

  /**
   * @description Builds the authentication headers for the active mode
   * @return {Record<string, string>} The authentication headers
   */
  private authHeaders(): Record<string, string> {
    if (this.usesTokenAuth)
      return {
        authorization: `token ${this.config.apiKey}:${this.config.apiSecret}`,
      };
    if (this._cookie) return { cookie: this._cookie };
    return {};
  }

  /**
   * @description Extracts the `sid` cookie from a login response
   * @summary Handles both a raw `set-cookie` header and a runtime that exposes the
   * header map as an array.
   * @param {ERPNextHttpResponse} response - The login response
   * @return {string | undefined} The cookie header value, when present
   */
  private extractCookie(
    response: ERPNextHttpResponse
  ): string | undefined {
    const headers = response.headers ?? {};
    const raw = headers["set-cookie"];
    if (!raw) return undefined;
    const cookies = Array.isArray(raw) ? raw : [raw];
    const sid = cookies.find((cookie) => cookie.startsWith("sid="));
    if (sid) return sid.split(";")[0];
    return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }

  /**
   * @description Serializes query parameters
   * @summary Arrays and objects are JSON encoded (Frappe expects JSON for `filters`
   * and `fields`); undefined values are skipped.
   * @param {Record<string, unknown>} [params] - The parameters
   * @return {string} The query string, including the leading `?` when non-empty
   */
  private toQueryString(
    params?: Record<string, unknown>
  ): string {
    if (!params) return "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "undefined" || value === null) continue;
      if (typeof value === "object")
        search.append(key, JSON.stringify(value));
      else search.append(key, String(value));
    }
    const query = search.toString();
    return query ? `?${query}` : "";
  }

  /**
   * @description Unwraps the Frappe response envelope
   * @summary Frappe answers `{ data: ... }` for resource calls and `{ message: ... }`
   * for method calls; both are reduced to their payload.
   * @param {ERPNextHttpResponse} response - The raw response
   * @return {any} The unwrapped payload
   */
  private unwrap(response: ERPNextHttpResponse): any {
    const body = response.data;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      if ("data" in body) return (body as { data: any }).data;
      if ("message" in body) return (body as { message: any }).message;
    }
    return body;
  }

  /**
   * @description Coerces a Frappe list payload into an array of records
   * @summary Frappe sometimes returns a single object where a list is expected;
   * this helper wraps it and returns an empty array for primitives.
   * @param {any} value - The decoded response value
   * @return {Record<string, any>[]} The list of records
   */
  private toArray(value: any): Record<string, any>[] {
    if (Array.isArray(value)) return value as Record<string, any>[];
    if (value && typeof value === "object") return [value];
    return [];
  }

  /**
   * @description Coerces a Frappe document payload into a record
   * @summary Returns the value when it is already an object and an empty record
   * otherwise, so callers always receive a document shape.
   * @param {any} value - The decoded response value
   * @return {Record<string, any>} The document record
   */
  private toObject(value: any): Record<string, any> {
    if (value && typeof value === "object") return value;
    return {};
  }
}
