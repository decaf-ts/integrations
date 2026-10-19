/**
 * @module integrations/io/graphql/service
 * @summary Generic GraphQL endpoint integration service for executing queries and mutations.
 * @description Posts GraphQL documents to any endpoint as a decaf
 * `@service("graphql")` client-based service built on {@link HttpApiService}.
 * The endpoint is supplied as `endpoint` (an alias normalized to `baseUrl`
 * during initialization) or the `io.graphql` environment slice; an optional
 * bearer token is attached to every request, per-request headers can extend
 * it, and failures are mapped to decaf errors via {@link httpError}. GraphQL
 * field-level `errors` are returned in the response rather than thrown —
 * callers decide how to handle partial results.
 */
import { service, type MaybeContextualArg } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import type { AxiosInstance } from "axios";
import { IoEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the GraphQL service
 * @summary Extends {@link HttpApiServiceConfig} with the GraphQL `endpoint`
 * URL (normalized to `baseUrl` during initialization) and the optional bearer
 * token. When omitted, the `io.graphql` environment slice supplies the
 * endpoint (and optional `token`, `timeout`).
 * @category IO
 * @memberOf module:integrations/io/graphql/service
 */
export interface GraphqlServiceConfig extends HttpApiServiceConfig {
  /**
   * @description GraphQL endpoint URL
   * @summary Aliased to `baseUrl` by {@link GraphqlService.initialize}; every
   * request is posted to this URL.
   */
  endpoint?: string;
  /**
   * @description Bearer token for the endpoint
   * @summary Sent as `Authorization: Bearer <token>` with every request.
   */
  token?: string;
}

/**
 * @description Input for a GraphQL request
 * @summary Carries the `query` document, the `variables` map referenced by
 * it, the optional `operationName` when the document holds multiple named
 * operations, and per-request `headers` merged into the client's defaults.
 * @category IO
 * @memberOf module:integrations/io/graphql/service
 */
export interface GraphqlRequest {
  /**
   * @description The GraphQL query or mutation document (required)
   */
  query: string;
  /**
   * @description Variable values for the document's declared variables
   */
  variables?: Record<string, unknown>;
  /**
   * @description The operation to execute when the document defines several
   */
  operationName?: string;
  /**
   * @description Extra headers merged over the client's defaults for this request
   */
  headers?: Record<string, string>;
}

/**
 * @description GraphQL response envelope
 * @summary The standard GraphQL execution result: `data` when the operation
 * produced results, field-level `errors` (message plus response path) when
 * execution partially failed, and provider `extensions`.
 * @template T - The expected type of the `data` payload.
 * @category IO
 * @memberOf module:integrations/io/graphql/service
 */
export interface GraphqlResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
  extensions?: Record<string, unknown>;
}

/**
 * @description Generic GraphQL endpoint integration service
 * @summary A decaf `@service("graphql")` HTTP service that `POST`s GraphQL
 * documents to any endpoint. Unlike the other integration services there is
 * no default base URL — the endpoint must come from the config (`endpoint` or
 * `baseUrl`) or the `io.graphql` environment slice. Initialization normalizes
 * the `endpoint` alias to `baseUrl` before delegating to the shared
 * {@link HttpApiService.initialize}; the optional token is sent as a bearer
 * header and per-request headers extend it. Transport failures are mapped to
 * decaf errors via {@link httpError}, while GraphQL field-level `errors` are
 * returned in the response for the caller to interpret.
 * @class GraphqlService
 * @category IO
 * @example
 * ```ts
 * import { GraphqlService } from "@decaf-ts/integrations/io/graphql";
 *
 * const graphql = new GraphqlService();
 * await graphql.initialize({
 *   endpoint: "https://api.example.com/graphql",
 *   token: process.env.GRAPH_CREDENTIAL_GRAPHQL_TOKEN,
 * });
 * const response = await graphql.request<{ user: { name: string } }>({
 *   query: `query GetUser($id: ID!) {
 *     user(id: $id) { name }
 *   }`,
 *   variables: { id: "123" },
 * });
 * ```
 * @memberOf module:integrations/io/graphql/service
 */
@service("graphql")
export class GraphqlService extends HttpApiService<GraphqlServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "GraphQL";

  /**
   * @description The absence of a default GraphQL endpoint
   * @summary Returns an empty string because GraphQL endpoints are
   * provider-specific; {@link GraphqlService.request} rejects execution when
   * no endpoint was configured.
   * @returns {string} An empty string.
   */
  protected defaultBaseUrl(): string {
    return "";
  }

  /**
   * @description Normalizes the `endpoint` alias before shared initialization
   * @summary When the provided config carries no `baseUrl` but an `endpoint`,
   * copies `endpoint` into `baseUrl` and delegates to
   * {@link HttpApiService.initialize}, which merges the environment slice and
   * builds the Axios client.
   * @param {...MaybeContextualArg<any>} args - An optional `Partial<GraphqlServiceConfig>`, optionally followed by a decaf `Context`.
   * @returns {Promise<{config: GraphqlServiceConfig, client: AxiosInstance}>} The merged configuration and the configured Axios instance.
   * @throws {InternalError} When no base URL can be resolved from the config or environment.
   */
  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: GraphqlServiceConfig; client: AxiosInstance }> {
    const provided = (args[0] ?? {}) as Partial<GraphqlServiceConfig>;
    if (!provided.baseUrl && provided.endpoint) {
      args[0] = { ...provided, baseUrl: provided.endpoint };
    }
    return super.initialize(...args);
  }

  /**
   * @description Builds the GraphQL bearer authorization headers
   * @summary Returns the `Authorization: Bearer <token>` header when the
   * config carries a token, and no headers otherwise.
   * @param {GraphqlServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: GraphqlServiceConfig): Record<string, string> {
    return config.token ? { Authorization: `Bearer ${config.token}` } : {};
  }

  /**
   * @description Reads the GraphQL endpoint and token from the environment
   * @summary Reads the `io.graphql` environment slice and returns a partial
   * config (with `endpoint` also mirrored to `baseUrl`) when an endpoint is
   * configured, `undefined` otherwise. Values pass through
   * `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<GraphqlServiceConfig> | undefined} A partial config, or `undefined` when no GraphQL endpoint is configured.
   */
  protected configFromEnvironment(): Partial<GraphqlServiceConfig> | undefined {
    const env = IoEnvironment.io.graphql;
    const endpoint = envString(env?.endpoint);
    if (!endpoint) return undefined;
    return {
      endpoint,
      baseUrl: endpoint,
      token: envString(env.token),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Executes a GraphQL query or mutation against the configured endpoint
   * @summary `POST`s the standard GraphQL request body (`query`,
   * `variables`, `operationName`) to the resolved endpoint with the optional
   * per-request headers merged over the client defaults. Requires a
   * non-empty query and a configured endpoint. Returns the raw execution
   * envelope: field-level `errors` are reported in `GraphqlResponse.errors`
   * rather than thrown, so callers must inspect them for partial failures.
   * @template T - The expected type of the `data` payload.
   * @param {GraphqlRequest} input - The query document, variables, operation name, and per-request headers.
   * @returns {Promise<GraphqlResponse<T>>} The execution envelope with `data`, `errors`, and `extensions`.
   * @throws {InternalError} When the query is empty or no endpoint is configured.
   * @throws {NotFoundError} When the endpoint answers with HTTP 404.
   * @throws {ConflictError} When the endpoint answers with HTTP 409.
   * @throws {BadRequestError} When the endpoint answers with any other HTTP error status.
   */
  async request<T = unknown>(
    input: GraphqlRequest
  ): Promise<GraphqlResponse<T>> {
    if (!input.query || input.query.trim().length === 0) {
      throw new InternalError("GraphQL request requires a query");
    }
    const endpoint = this.config.endpoint ?? this.config.baseUrl;
    if (!endpoint) {
      throw new InternalError("GraphQL requires an endpoint");
    }
    try {
      const response = await this.client.post<GraphqlResponse<T>>(
        endpoint,
        {
          query: input.query,
          variables: input.variables,
          operationName: input.operationName,
        },
        { headers: input.headers }
      );
      return response.data;
    } catch (error) {
      throw httpError("GraphQL", "request", error);
    }
  }
}
