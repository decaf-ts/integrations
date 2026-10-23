import Axios, { type AxiosInstance } from "axios";
import {
  ClientBasedService,
  MaybeContextualArg,
  PersistenceKeys,
} from "@decaf-ts/core";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";

/**
 * @module integrations/shared/http/base-service
 * @summary Shared HTTP base service, config contract, and error mapping for the HTTP-backed integration services.
 * @description Provides the `HttpApiServiceConfig` shape consumed by every Stage 3b HTTP-backed
 * integration service (Slack, Telegram, Teams, Gmail, GitHub, GitLab, Google Sheets, Airtable, and
 * GraphQL), the abstract `HttpApiService` client-based service that turns a config into a
 * configured Axios instance, and the `httpError` mapper that converts transport failures into
 * decaf `BadRequestError`/`ConflictError`/`NotFoundError`/`InternalError` errors. Concrete
 * services extend `HttpApiService` and only supply their base URL, auth headers, and environment
 * slice, inheriting initialization and error mapping.
 */
/**
 * @description Base configuration shared by every HTTP-backed integration service
 * @summary Carries the optional `baseUrl` override (falling back to the service's
 * `defaultBaseUrl()`), credentials (`token`, or `username`/`password` for basic-auth
 * style APIs), an Axios `timeout` in milliseconds (defaults to `30000`), and any
 * extra default `headers` merged after the service's own `authHeaders`. Concrete
 * services extend this interface with their provider-specific fields.
 * @category Shared
 * @memberOf module:integrations/shared/http/base-service
 */
export interface HttpApiServiceConfig {
  /**
   * @description Base URL override for the service client
   * @summary When omitted, the concrete service's `defaultBaseUrl()` is used.
   */
  baseUrl?: string;
  /**
   * @description Bearer or provider token used for authentication
   * @summary How the token is sent (header name, scheme, or query parameter) is
   * decided by each concrete service's `authHeaders()` implementation.
   */
  token?: string;
  /**
   * @description Optional username for basic-auth style APIs
   * @summary Used together with {@link HttpApiServiceConfig.password} by services
   * that authenticate with HTTP basic credentials.
   */
  username?: string;
  /**
   * @description Optional password for basic-auth style APIs
   * @summary Used together with {@link HttpApiServiceConfig.username}.
   */
  password?: string;
  /**
   * @description Request timeout in milliseconds
   * @summary Applied to the Axios instance created by
   * {@link HttpApiService.initialize}; defaults to `30000` when omitted.
   */
  timeout?: number;
  /**
   * @description Extra default headers merged into every request
   * @summary Merged after the service's own `authHeaders()`, so explicit
   * `headers` entries take precedence over generated auth headers.
   */
  headers?: Record<string, string>;
}

/*
 * Marker (SAA-1039 F2 / SAA-1044 F8): the undocumented duplicate
 * `HttpApiServiceConfig` declaration that used to sit here has been removed.
 * The documented declaration above is the single authoritative shape.
 */

/**
 * @description Maps a transport or provider failure to a decaf error
 * @summary Normalizes `unknown` caught errors into the decaf error hierarchy.
 * Already-mapped decaf errors are returned unchanged; errors carrying an HTTP
 * response are mapped by status (`404` to `NotFoundError`, `409` to
 * `ConflictError`, everything else to `BadRequestError` with the response body
 * as detail); any other failure becomes an `InternalError` carrying the
 * original message. Concrete services wrap their API calls with this mapper so
 * callers only ever observe decaf errors.
 * @param {string} serviceName - Human-readable provider name used to prefix the error message (e.g. `"Slack"`).
 * @param {string} action - Short description of the failing operation (e.g. `"API chat.postMessage"`).
 * @param {unknown} error - The caught error: a decaf error, an Axios-style error with an HTTP `response`, or anything else.
 * @returns {Error} The corresponding decaf error: the input unchanged when already a decaf error, a status-mapped `NotFoundError`/`ConflictError`/`BadRequestError` when an HTTP response is present, or an `InternalError` otherwise.
 * @category Shared
 * @memberOf module:integrations/shared/http/base-service
 */
export function httpError(
  serviceName: string,
  action: string,
  error: unknown
): Error {
  if (
    error instanceof InternalError ||
    error instanceof BadRequestError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError
  ) {
    return error;
  }
  const response = (
    error as {
      response?: { status?: number; data?: unknown; statusText?: string };
    }
  )?.response;
  if (response) {
    const status = response.status ?? 0;
    const detail =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data ?? {});
    const message = `${serviceName} ${action} failed with HTTP ${status}${
      detail && detail !== "{}" ? `: ${detail}` : ""
    }`;
    if (status === 404) return new NotFoundError(message);
    if (status === 409) return new ConflictError(message);
    return new BadRequestError(message);
  }
  return new InternalError(
    `${serviceName} ${action} failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

/**
 * @description Abstract base service for HTTP-backed provider integrations
 * @summary Implements the shared `ClientBasedService` lifecycle for REST-style
 * providers: `initialize()` merges an explicitly provided config with the
 * concrete service's environment slice, resolves the effective base URL
 * (explicit `baseUrl`, then `defaultBaseUrl()`), and builds an `AxiosInstance`
 * with the JSON content type, the service's `authHeaders()`, and any extra
 * config `headers`. Subclasses declare their `serviceName`, supply a
 * `defaultBaseUrl()`, optionally override `authHeaders()` and
 * `configFromEnvironment()`, and use `requireToken()` in operations that
 * mandate a token. Callers always pass a concrete config object (or rely on
 * the environment slice) and receive typed decaf errors through
 * {@link httpError}.
 * @class HttpApiService
 * @category Shared
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as HttpApiService
 *   participant Env as Environment slice
 *   participant Axios as Axios
 *   Caller->>Service: initialize(providedConfig?)
 *   activate Service
 *   Service->>Env: configFromEnvironment()
 *   activate Env
 *   Env-->>Service: partial config (or undefined)
 *   deactivate Env
 *   Service->>Service: merge { ...environment, ...provided }
 *   alt baseUrl configured
 *     Service->>Service: baseUrl = config.baseUrl
 *   else baseUrl missing
 *     Service->>Service: baseUrl = defaultBaseUrl()
 *     alt still missing
 *       Service--xCaller: InternalError (requires a base URL)
 *     end
 *   end
 *   Service->>Axios: create({ baseURL, timeout, headers })
 *   activate Axios
 *   Axios-->>Service: AxiosInstance
 *   deactivate Axios
 *   Service-->>Caller: { config, client }
 *   deactivate Service
 * @example
 * ```ts
 * import { SlackService } from "@decaf-ts/integrations/comms/slack";
 *
 * const slack = new SlackService();
 * // explicit config; when omitted, initialize() falls back to the
 * // service's environment slice (e.g. GRAPH_CREDENTIAL_SLACK_TOKEN)
 * await slack.initialize({ token: process.env.GRAPH_CREDENTIAL_SLACK_TOKEN });
 * ```
 * @memberOf module:integrations/shared/http/base-service
 */
export abstract class HttpApiService<
  CONF extends HttpApiServiceConfig,
> extends ClientBasedService<AxiosInstance, CONF> {
  constructor() {
    super();
  }

  /**
   * @description Human-readable provider name used in error messages
   * @summary Subclasses must declare this (e.g. `"Slack"`, `"GitHub"`); it
   * prefixes messages thrown for missing base URLs, tokens, and mapped errors.
   */
  protected abstract readonly serviceName: string;

  /**
   * @description The provider's default API base URL
   * @summary Used by {@link HttpApiService.initialize} when the resolved
   * config carries no `baseUrl`.
   * @returns {string} The provider's default base URL (e.g. `"https://api.github.com"`).
   */
  protected abstract defaultBaseUrl(): string;

  /**
   * @description Builds the default authentication headers for a config
   * @summary Invoked by {@link HttpApiService.initialize} when creating the
   * Axios instance. The base implementation returns no headers; subclasses
   * override it to translate `config.token`/`username`/`password` into
   * provider-specific headers (e.g. `Authorization: Bearer ...`).
   * @param {CONF} config - The resolved service configuration.
   * @returns {Record<string, string>} The headers to send with every request; empty when the config carries no credentials.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected authHeaders(_config: CONF): Record<string, string> {
    return {};
  }

  /**
   * @description Reads the service's credentials and defaults from the environment
   * @summary Invoked by {@link HttpApiService.initialize} and merged under the
   * explicitly provided config (explicit values win). Subclasses override this
   * to read their `LoggedEnvironment` slice with the
   * `envString`/`envNumber`/`envBoolean` helpers and return `undefined` when
   * the slice is not configured at all.
   * @returns {Partial<CONF> | undefined} A partial config from the environment, or `undefined` when the environment carries no usable credentials.
   */
  protected configFromEnvironment(): Partial<CONF> | undefined {
    return undefined;
  }

  /**
   * @description Resolves the config and builds the Axios client
   * @summary Merges the explicitly provided config (first argument, when
   * present) over the environment slice from `configFromEnvironment()`,
   * resolves the effective base URL (explicit `baseUrl`, then
   * `defaultBaseUrl()`), and creates an Axios instance with the resolved
   * `timeout` (default `30000`), JSON content type, `authHeaders(config)`,
   * and any extra config `headers`. The resolved config and client are also
   * stored on the service for subsequent operations.
   * @param {...MaybeContextualArg<any>} args - An optional `Partial<CONF>`, optionally followed by a decaf `Context`.
   * @returns {Promise<{config: CONF, client: AxiosInstance}>} The merged configuration and the configured Axios instance.
   * @throws {InternalError} When neither the config nor `defaultBaseUrl()` yields a base URL.
   */
  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: CONF; client: AxiosInstance }> {
    const { ctxArgs } = (
      await this.logCtx(args, PersistenceKeys.INITIALIZATION, true)
    ).for(this.initialize);
    const provided = (ctxArgs[0] ?? {}) as Partial<CONF>;
    const fromEnvironment = this.configFromEnvironment() ?? {};
    const config = { ...fromEnvironment, ...provided } as CONF;
    const baseUrl = config.baseUrl ?? this.defaultBaseUrl();
    if (!baseUrl) {
      throw new InternalError(`${this.serviceName} requires a base URL`);
    }
    const client = Axios.create({
      baseURL: baseUrl,
      timeout: config.timeout ?? 30000,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(config),
        ...(config.headers ?? {}),
      },
    });
    this._config = config;
    this._client = client;
    return { config, client };
  }

  /**
   * @description Asserts that the service was configured with a token
   * @summary Reads the resolved config and throws when no `token` is present;
   * operations that require authenticated access call this before issuing
   * requests.
   * @param {CONF} [config] - The config to validate; defaults to the service's resolved config.
   * @returns {string} The configured token.
   * @throws {InternalError} When the config carries no `token`.
   */
  protected requireToken(config: CONF = this.config): string {
    if (!config.token) {
      throw new InternalError(`${this.serviceName} requires a token`);
    }
    return config.token;
  }
}
