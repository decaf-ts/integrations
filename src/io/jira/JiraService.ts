/**
 * @module integrations/io/jira/service
 * @summary Jira REST API integration service for issues, comments, and workflows.
 * @description Exposes Jira issue operations (create, read, update, delete,
 * comment, transition, and JQL search) through the Jira REST `api/2` surface as
 * an undecorated client-based service built on {@link HttpApiService}.
 * Configuration comes from an explicit `JiraServiceConfig` or the `io.jira`
 * environment slice. When both `username` and `token` are configured the
 * service sends HTTP Basic authentication (API token as the password);
 * otherwise the token is sent as a bearer token. The site `baseUrl` is
 * required. Credentials are referenced from configuration (and, from as-graph
 * nodes, from the resolved `jira` credential secret) and are never embedded in
 * source. Failures are mapped to decaf errors via {@link httpError}.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { IoEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the Jira service
 * @summary Extends {@link HttpApiServiceConfig} with the API `token`, the
 * optional `username` that enables Basic authentication, and the required site
 * `baseUrl`. When omitted, the `io.jira` environment slice supplies the same
 * values (plus optional `timeout`).
 * @category IO
 * @memberOf module:integrations/io/jira/service
 */
export interface JiraServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Jira API token
   * @summary Used as the Basic-auth password when `username` is set, otherwise as a bearer token.
   */
  token?: string;
  /**
   * @description Jira account username for Basic authentication
   */
  username?: string;
}

/**
 * @description Input for creating a Jira issue
 * @summary Carries the target `projectKey`, issue `summary`, optional
 * `issueType` (default `Task`), `description`, and additional raw `fields`
 * merged into the create payload.
 * @category IO
 * @memberOf module:integrations/io/jira/service
 */
export interface JiraIssueInput {
  /**
   * @description Project key that owns the new issue
   */
  projectKey: string;
  /**
   * @description Issue summary
   */
  summary: string;
  /**
   * @description Issue type name (default `Task`)
   */
  issueType?: string;
  /**
   * @description Issue description
   */
  description?: string;
  /**
   * @description Additional Jira fields merged into the create payload
   */
  fields?: Record<string, unknown>;
}

/**
 * @description Input for updating a Jira issue
 * @summary Carries the target `issueKey` and the `fields` map to update.
 * @category IO
 * @memberOf module:integrations/io/jira/service
 */
export interface JiraIssueUpdate {
  /**
   * @description Issue key to update (e.g. `"SAA-123"`)
   */
  issueKey: string;
  /**
   * @description Fields to update
   */
  fields: Record<string, unknown>;
}

/**
 * @description Input for commenting on a Jira issue
 * @summary Carries the target `issueKey` and the comment `body`.
 * @category IO
 * @memberOf module:integrations/io/jira/service
 */
export interface JiraCommentInput {
  /**
   * @description Issue key to comment on
   */
  issueKey: string;
  /**
   * @description Comment body
   */
  body: string;
}

/**
 * @description Input for transitioning a Jira issue
 * @summary Carries the target `issueKey` and the workflow `transitionId`.
 * @category IO
 * @memberOf module:integrations/io/jira/service
 */
export interface JiraTransitionInput {
  /**
   * @description Issue key to transition
   */
  issueKey: string;
  /**
   * @description Workflow transition ID
   */
  transitionId: string;
}

/**
 * @description Input for a Jira JQL search
 * @summary Carries the `jql` query, an optional result cap (default `50`), and
 * an optional list of `fields` to project.
 * @category IO
 * @memberOf module:integrations/io/jira/service
 */
export interface JiraSearchInput {
  /**
   * @description JQL query expression
   */
  jql: string;
  /**
   * @description Maximum number of results (default `50`)
   */
  maxResults?: number;
  /**
   * @description Field names to include in the results
   */
  fields?: string[];
}

/** Default issue type written when a create does not specify one (`"Task"`). */
const DEFAULT_ISSUE_TYPE = "Task";

/**
 * @description Jira REST API integration service
 * @summary An undecorated HTTP service for issue CRUD, comments, workflow
 * transitions, and JQL search. The site base URL and API token are required;
 * supplying a `username` switches authentication to Basic, and transport
 * failures are mapped to decaf errors via {@link httpError}.
 * @class JiraService
 * @extends HttpApiService
 * @category IO
 * @example
 * ```ts
 * import { JiraService } from "@decaf-ts/integrations/io/jira";
 *
 * const jira = new JiraService();
 * await jira.initialize({
 *   baseUrl: "https://example.atlassian.net",
 *   username: process.env.JIRA_USERNAME,
 *   token: process.env.GRAPH_CREDENTIAL_JIRA_TOKEN,
 * });
 * const issue = await jira.createIssue({
 *   projectKey: "OPS",
 *   summary: "Deployment failed",
 * });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as JiraService
 *   participant API as Jira REST API
 *   Caller->>Service: createIssue(input)
 *   activate Service
 *   Service->>Service: requireCredentials()
 *   Service->>API: POST /rest/api/2/issue
 *   activate API
 *   API-->>Service: { id, key }
 *   deactivate API
 *   Service-->>Caller: created issue
 *   deactivate Service
 * @memberOf module:integrations/io/jira/service
 */
export class JiraService extends HttpApiService<JiraServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Jira";

  /**
   * @description The default base URL for Jira
   * @summary Returns an empty string; Jira is site-hosted, so the resolved
   * `baseUrl` (from config or `io.jira.baseUrl`) is required.
   * @returns {string} An empty string.
   */
  protected defaultBaseUrl(): string {
    return "";
  }

  /**
   * @description Builds the Jira authentication headers
   * @summary Uses HTTP Basic (`username:token`) when both values are present,
   * otherwise a bearer token when only `token` is present. Always requests
   * JSON responses.
   * @param {JiraServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization and accept headers.
   */
  protected authHeaders(config: JiraServiceConfig): Record<string, string> {
    if (config.username && config.token) {
      const encoded = Buffer.from(
        `${config.username}:${config.token}`,
        "utf8"
      ).toString("base64");
      return {
        Authorization: `Basic ${encoded}`,
        Accept: "application/json",
      };
    }
    return config.token
      ? { Authorization: `Bearer ${config.token}`, Accept: "application/json" }
      : { Accept: "application/json" };
  }

  /**
   * @description Reads the Jira credentials and defaults from the environment
   * @summary Reads the `io.jira` slice and returns a partial config when an
   * API token is configured, `undefined` otherwise. Values pass through
   * `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<JiraServiceConfig> | undefined} A partial config, or `undefined` when no Jira token is configured.
   */
  protected configFromEnvironment(): Partial<JiraServiceConfig> | undefined {
    const env = IoEnvironment.io.jira;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      username: envString(env.username),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts that the Jira token and site base URL are configured
   * @summary Called by every operation before it touches the network.
   * @returns {void}
   * @throws {InternalError} When no API token or base URL is configured.
   */
  protected requireCredentials(): void {
    if (!this.config.token) {
      throw new InternalError("Jira requires an API token");
    }
    if (!this.config.baseUrl) {
      throw new InternalError("Jira requires a base URL");
    }
  }

  /**
   * @description Builds the encoded issue path
   * @summary Validates the issue key and URL-encodes it into
   * `/rest/api/2/issue/<key>`.
   * @param {string} issueKey - The Jira issue key.
   * @returns {string} The issue API path.
   * @throws {InternalError} When `issueKey` is empty.
   */
  private issuePath(issueKey: string): string {
    if (!issueKey) {
      throw new InternalError("Jira requires an issue key");
    }
    return `/rest/api/2/issue/${encodeURIComponent(issueKey)}`;
  }

  /**
   * @description Creates a Jira issue
   * @summary `POST`s the project, summary, issue type (default `Task`),
   * optional description, and extra fields to `/rest/api/2/issue`.
   * @param {JiraIssueInput} input - The issue definition.
   * @returns {Promise<unknown>} The created issue payload (including `id` and `key`).
   * @throws {InternalError} When credentials are missing, or the project key or summary is empty.
   * @throws {BadRequestError} When Jira rejects the issue.
   */
  async createIssue(input: JiraIssueInput): Promise<unknown> {
    this.requireCredentials();
    if (!input.projectKey || !input.summary) {
      throw new InternalError(
        "Jira createIssue requires a project key and summary"
      );
    }
    try {
      const response = await this.client.post("/rest/api/2/issue", {
        fields: {
          project: { key: input.projectKey },
          summary: input.summary,
          issuetype: { name: input.issueType ?? DEFAULT_ISSUE_TYPE },
          ...(input.description ? { description: input.description } : {}),
          ...(input.fields ?? {}),
        },
      });
      return response.data;
    } catch (error) {
      throw httpError("Jira", "create issue", error);
    }
  }

  /**
   * @description Fetches a Jira issue
   * @summary `GET`s the issue by key, optionally projecting the given field
   * names.
   * @param {string} issueKey - The issue key to fetch.
   * @param {string[]} [fields] - Field names to include in the response.
   * @returns {Promise<unknown>} The issue payload.
   * @throws {InternalError} When credentials are missing or the issue key is empty.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {BadRequestError} When Jira rejects the request.
   */
  async getIssue(issueKey: string, fields?: string[]): Promise<unknown> {
    this.requireCredentials();
    try {
      const response = await this.client.get(this.issuePath(issueKey), {
        params: fields?.length ? { fields: fields.join(",") } : {},
      });
      return response.data;
    } catch (error) {
      throw httpError("Jira", "get issue", error);
    }
  }

  /**
   * @description Updates fields on a Jira issue
   * @summary `PUT`s the `fields` map to the issue and returns
   * `{ updated: true, issueKey }`.
   * @param {JiraIssueUpdate} input - The issue key and fields to update.
   * @returns {Promise<unknown>} `{ updated: true, issueKey }` on success.
   * @throws {InternalError} When credentials are missing, or the issue key or fields are empty.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {BadRequestError} When Jira rejects the update.
   */
  async updateIssue(input: JiraIssueUpdate): Promise<unknown> {
    this.requireCredentials();
    if (!input.fields) {
      throw new InternalError("Jira updateIssue requires fields");
    }
    try {
      await this.client.put(this.issuePath(input.issueKey), {
        fields: input.fields,
      });
      return { updated: true, issueKey: input.issueKey };
    } catch (error) {
      throw httpError("Jira", "update issue", error);
    }
  }

  /**
   * @description Deletes a Jira issue
   * @summary `DELETE`s the issue and returns `{ deleted: true, issueKey }`.
   * @param {string} issueKey - The issue key to delete.
   * @returns {Promise<unknown>} `{ deleted: true, issueKey }` on success.
   * @throws {InternalError} When credentials are missing or the issue key is empty.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {BadRequestError} When Jira rejects the deletion.
   */
  async deleteIssue(issueKey: string): Promise<unknown> {
    this.requireCredentials();
    try {
      await this.client.delete(this.issuePath(issueKey));
      return { deleted: true, issueKey };
    } catch (error) {
      throw httpError("Jira", "delete issue", error);
    }
  }

  /**
   * @description Adds a comment to a Jira issue
   * @summary `POST`s the comment body to the issue's `/comment` endpoint.
   * @param {JiraCommentInput} input - The issue key and comment body.
   * @returns {Promise<unknown>} The created comment payload.
   * @throws {InternalError} When credentials are missing, or the issue key or body is empty.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {BadRequestError} When Jira rejects the comment.
   */
  async addComment(input: JiraCommentInput): Promise<unknown> {
    this.requireCredentials();
    if (!input.body) {
      throw new InternalError("Jira addComment requires a body");
    }
    try {
      const response = await this.client.post(
        `${this.issuePath(input.issueKey)}/comment`,
        { body: input.body }
      );
      return response.data;
    } catch (error) {
      throw httpError("Jira", "add comment", error);
    }
  }

  /**
   * @description Lists the available workflow transitions for a Jira issue
   * @summary `GET`s the issue's `/transitions` collection, whose IDs feed
   * {@link JiraService.transitionIssue}.
   * @param {string} issueKey - The issue key.
   * @returns {Promise<unknown>} The available transitions payload.
   * @throws {InternalError} When credentials are missing or the issue key is empty.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {BadRequestError} When Jira rejects the request.
   */
  async getTransitions(issueKey: string): Promise<unknown> {
    this.requireCredentials();
    try {
      const response = await this.client.get(
        `${this.issuePath(issueKey)}/transitions`
      );
      return response.data;
    } catch (error) {
      throw httpError("Jira", "get transitions", error);
    }
  }

  /**
   * @description Transitions a Jira issue through its workflow
   * @summary `POST`s the transition ID to the issue's `/transitions` endpoint
   * and returns the applied transition identifiers.
   * @param {JiraTransitionInput} input - The issue key and transition ID.
   * @returns {Promise<unknown>} `{ transitioned: true, issueKey, transitionId }` on success.
   * @throws {InternalError} When credentials are missing, or the issue key or transition ID is empty.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {BadRequestError} When Jira rejects the transition.
   */
  async transitionIssue(input: JiraTransitionInput): Promise<unknown> {
    this.requireCredentials();
    if (!input.transitionId) {
      throw new InternalError("Jira transitionIssue requires a transition id");
    }
    try {
      await this.client.post(`${this.issuePath(input.issueKey)}/transitions`, {
        transition: { id: input.transitionId },
      });
      return {
        transitioned: true,
        issueKey: input.issueKey,
        transitionId: input.transitionId,
      };
    } catch (error) {
      throw httpError("Jira", "transition issue", error);
    }
  }

  /**
   * @description Searches Jira issues with JQL
   * @summary `POST`s the JQL query to `/rest/api/2/search` with a result cap
   * (default `50`) and optional field projection.
   * @param {JiraSearchInput} input - The JQL query and search options.
   * @returns {Promise<unknown>} The search result payload.
   * @throws {InternalError} When credentials are missing or the JQL query is empty.
   * @throws {BadRequestError} When the JQL query is invalid.
   * @example
   * ```ts
   * const results = await jira.search({
   *   jql: 'project = "OPS" AND status = "Open"',
   *   maxResults: 100,
   *   fields: ["summary", "status"],
   * });
   * ```
   */
  async search(input: JiraSearchInput): Promise<unknown> {
    this.requireCredentials();
    if (!input.jql) {
      throw new InternalError("Jira search requires a JQL query");
    }
    try {
      const response = await this.client.post("/rest/api/2/search", {
        jql: input.jql,
        maxResults: input.maxResults ?? 50,
        ...(input.fields ? { fields: input.fields } : {}),
      });
      return response.data;
    } catch (error) {
      throw httpError("Jira", "search issues", error);
    }
  }
}
