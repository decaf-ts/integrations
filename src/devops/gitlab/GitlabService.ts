/**
 * @module integrations/devops/gitlab/service
 * @summary GitLab REST API integration service for projects, issues, and merge requests.
 * @description Exposes a focused subset of the GitLab REST v4 API (`/projects/*`:
 * project lookup, issue listing/creation/commenting, and merge-request
 * listing) as a decaf `@service("gitlab")` client-based service built on
 * {@link HttpApiService}. Configuration comes from an explicit
 * `GitlabServiceConfig` or the `devops.gitlab` environment slice; project
 * targets default to the configured `projectId` and can be overridden per
 * call. Raw GitLab responses are normalized to camelCase issue descriptors,
 * and failures are mapped to decaf errors via {@link httpError}.
 */
import { service } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { DevopsEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the GitLab service
 * @summary Extends {@link HttpApiServiceConfig} with the GitLab personal
 * access token (sent as the `PRIVATE-TOKEN` header) and the default
 * `projectId` used when a call does not override it. When omitted, the
 * `devops.gitlab` environment slice supplies the token (and optional
 * `projectId`, `baseUrl`, `timeout`).
 * @category DevOps
 * @memberOf module:integrations/devops/gitlab/service
 */
export interface GitlabServiceConfig extends HttpApiServiceConfig {
  /**
   * @description GitLab personal access token
   * @summary Sent as the `PRIVATE-TOKEN` header with every API call.
   */
  token?: string;
  /**
   * @description Default project ID used when a call does not override it
   * @summary Accepts the URL-encoded project path or the numeric project ID.
   */
  projectId?: string;
}

/**
 * @description Input for creating a GitLab issue
 * @summary Carries the optional `projectId` override, the required issue
 * `title`, and the optional description, comma-separated `labels`,
 * `assigneeIds`, and `milestoneId`.
 * @category DevOps
 * @memberOf module:integrations/devops/gitlab/service
 */
export interface GitlabIssueInput {
  /**
   * @description Project ID for this call
   * @summary Falls back to the configured `GitlabServiceConfig.projectId`.
   */
  projectId?: string;
  /**
   * @description Issue title (required by the GitLab API)
   */
  title: string;
  /**
   * @description Issue description in markdown
   */
  description?: string;
  /**
   * @description Comma-separated label names to apply
   */
  labels?: string;
  /**
   * @description GitLab user IDs to assign
   */
  assigneeIds?: number[];
  /**
   * @description Milestone ID to associate
   */
  milestoneId?: number;
}

/**
 * @description Normalized GitLab issue descriptor
 * @summary Maps the raw GitLab issue payload onto camelCase fields: identity
 * (`iid`, `title`, `state`), `webUrl`, description and author, `labels`,
 * and `createdAt`/`updatedAt` timestamps.
 * @category DevOps
 * @memberOf module:integrations/devops/gitlab/service
 */
export interface GitlabIssue {
  projectId?: string;
  iid: number;
  title: string;
  state?: string;
  webUrl?: string;
  description?: string;
  author?: string;
  labels?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * @description Options for listing GitLab issues or merge requests
 * @summary Carries the optional `projectId` override, the `state` filter, a
 * page size (`limit`) and `page` number for paging, a comma-separated
 * `labels` filter, and a `search` term. Merge-request listings pass the state
 * through unchanged except for `"all"`, which GitLab models by omitting the
 * parameter.
 * @category DevOps
 * @memberOf module:integrations/devops/gitlab/service
 */
export interface GitlabListOptions {
  /**
   * @description Project ID for this call
   * @summary Falls back to the configured `GitlabServiceConfig.projectId`.
   */
  projectId?: string;
  /**
   * @description Issue/merge-request state filter
   */
  state?: "opened" | "closed" | "all";
  /**
   * @description Page size (GitLab's `per_page`); defaults to `30`
   */
  limit?: number;
  /**
   * @description Page number to request
   */
  page?: number;
  /**
   * @description Comma-separated label names to filter issues by
   */
  labels?: string;
  /**
   * @description Search term matched against issue/merge-request titles and descriptions
   */
  search?: string;
}

/**
 * @description GitLab REST API integration service
 * @summary A decaf `@service("gitlab")` HTTP service for looking up projects,
 * listing issues, creating issues, commenting on issues (notes), and listing
 * merge requests. Project targets resolve per call from the input's
 * `projectId`, falling back to the configured value, and throw
 * `InternalError` when unresolved. The token is sent as the `PRIVATE-TOKEN`
 * header, and transport failures are mapped to decaf errors via
 * {@link httpError}.
 * @class GitlabService
 * @category DevOps
 * @example
 * ```ts
 * import { GitlabService } from "@decaf-ts/integrations/devops/gitlab";
 *
 * const gitlab = new GitlabService();
 * await gitlab.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_GITLAB_TOKEN,
 *   projectId: "example-org%2Fexample-repo",
 * });
 * const issue = await gitlab.createIssue({
 *   title: "Bug report",
 *   description: "Something is broken",
 * });
 * ```
 * @memberOf module:integrations/devops/gitlab/service
 */
@service("gitlab")
export class GitlabService extends HttpApiService<GitlabServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "GitLab";

  /**
   * @description The GitLab REST v4 base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://gitlab.com/api/v4"`.
   */
  protected defaultBaseUrl(): string {
    return "https://gitlab.com/api/v4";
  }

  /**
   * @description Builds the GitLab `PRIVATE-TOKEN` authorization headers
   * @summary Returns the `PRIVATE-TOKEN: <token>` header when the config
   * carries a token, and no headers otherwise.
   * @param {GitlabServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(config: GitlabServiceConfig): Record<string, string> {
    return config.token ? { "PRIVATE-TOKEN": config.token } : {};
  }

  /**
   * @description Reads the GitLab credentials and defaults from the environment
   * @summary Reads the `devops.gitlab` environment slice and returns a
   * partial config when a token is configured, `undefined` otherwise. Values
   * pass through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<GitlabServiceConfig> | undefined} A partial config, or `undefined` when no GitLab token is configured.
   */
  protected configFromEnvironment(): Partial<GitlabServiceConfig> | undefined {
    const env = DevopsEnvironment.devops.gitlab;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      projectId: envString(env.projectId),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Resolves the URL-encoded project path for a call
   * @summary Builds `/projects/<projectId>` from the given project ID,
   * falling back to the configured value, and throws when neither is
   * available.
   * @param {string} [projectId] - The per-call project override (URL-encoded path or numeric ID).
   * @returns {string} The URL-encoded project API path.
   * @throws {InternalError} When neither the input nor the config yields a project ID.
   */
  protected projectPath(projectId?: string): string {
    const resolved = projectId ?? this.config.projectId;
    if (!resolved) throw new InternalError("GitLab requires a project ID");
    return `/projects/${encodeURIComponent(resolved)}`;
  }

  /**
   * @description Normalizes a raw GitLab issue payload
   * @summary Maps the raw issue JSON onto a {@link GitlabIssue}: the author
   * to its `username`, the label array to strings, and numeric/string fields
   * are coerced. The project ID is echoed from the input, falling back to the
   * configured value.
   * @param {Record<string, unknown>} raw - The raw GitLab issue payload.
   * @param {string} [projectId] - The project ID the issue belongs to.
   * @returns {GitlabIssue} The normalized issue descriptor.
   */
  protected mapIssue(
    raw: Record<string, unknown>,
    projectId?: string
  ): GitlabIssue {
    return {
      projectId: projectId ?? this.config.projectId,
      iid: Number(raw["iid"] ?? raw["id"] ?? 0),
      title: String(raw["title"] ?? ""),
      state: envString(raw["state"]),
      webUrl: envString(raw["web_url"]),
      description: envString(raw["description"]),
      author: envString(
        (raw["author"] as { username?: string } | undefined)?.username
      ),
      labels: Array.isArray(raw["labels"])
        ? (raw["labels"] as unknown[]).map((label) => String(label))
        : undefined,
      createdAt: envString(raw["created_at"]),
      updatedAt: envString(raw["updated_at"]),
    };
  }

  /**
   * @description Fetches a GitLab project
   * @summary `GET`s `/projects/<projectId>` for the given ID (falling back to
   * the configured `projectId`) and returns the raw project payload.
   * @param {string} [projectId] - The project to look up; defaults to the configured `projectId`.
   * @returns {Promise<unknown>} The raw GitLab project payload.
   * @throws {InternalError} When the project ID cannot be resolved.
   * @throws {NotFoundError} When the project does not exist (HTTP 404).
   * @throws {ConflictError} When GitLab answers with HTTP 409.
   * @throws {BadRequestError} When GitLab answers with any other HTTP error status.
   */
  async getProject(projectId?: string): Promise<unknown> {
    try {
      const response = await this.client.get(this.projectPath(projectId));
      return response.data;
    } catch (error) {
      throw httpError("GitLab", "get project", error);
    }
  }

  /**
   * @description Lists GitLab issues with state, label, search, and page filtering
   * @summary `GET`s `/projects/<projectId>/issues` with a `state` filter
   * (default `"opened"`), a page size (`per_page`, default `30`), a page
   * number, a comma-separated `labels` filter, and a `search` term.
   * @param {GitlabListOptions} [options] - Project override, state, paging, label, and search options.
   * @returns {Promise<GitlabIssue[]>} The normalized issues for the requested page.
   * @throws {InternalError} When the project ID cannot be resolved.
   * @throws {NotFoundError} When the project does not exist (HTTP 404).
   * @throws {ConflictError} When GitLab answers with HTTP 409.
   * @throws {BadRequestError} When GitLab answers with any other HTTP error status.
   * @example
   * ```ts
   * const issues = await gitlab.listIssues({
   *   projectId: "example-org%2Fexample-repo",
   *   state: "opened",
   *   labels: "bug,priority::high",
   *   limit: 50,
   *   page: 1,
   * });
   * ```
   */
  async listIssues(options: GitlabListOptions = {}): Promise<GitlabIssue[]> {
    try {
      const response = await this.client.get<Array<Record<string, unknown>>>(
        `${this.projectPath(options.projectId)}/issues`,
        {
          params: {
            state: options.state ?? "opened",
            per_page: options.limit ?? 30,
            page: options.page,
            labels: options.labels,
            search: options.search,
          },
        }
      );
      return response.data.map((entry) =>
        this.mapIssue(entry, options.projectId)
      );
    } catch (error) {
      throw httpError("GitLab", "list issues", error);
    }
  }

  /**
   * @description Creates a GitLab issue
   * @summary `POST`s the title, description, labels, assignee IDs, and
   * milestone ID to `/projects/<projectId>/issues` and returns the normalized
   * issue descriptor. Requires a non-empty `title` and a resolvable project
   * ID.
   * @param {GitlabIssueInput} input - The issue content and project targeting.
   * @returns {Promise<GitlabIssue>} The normalized created issue.
   * @throws {InternalError} When the title is empty or the project ID cannot be resolved.
   * @throws {NotFoundError} When the project does not exist (HTTP 404).
   * @throws {ConflictError} When GitLab answers with HTTP 409.
   * @throws {BadRequestError} When GitLab answers with any other HTTP error status (e.g. invalid labels or assignees).
   */
  async createIssue(input: GitlabIssueInput): Promise<GitlabIssue> {
    if (!input.title) {
      throw new InternalError("GitLab issue requires a title");
    }
    try {
      const response = await this.client.post<Record<string, unknown>>(
        `${this.projectPath(input.projectId)}/issues`,
        {
          title: input.title,
          description: input.description,
          labels: input.labels,
          assignee_ids: input.assigneeIds,
          milestone_id: input.milestoneId,
        }
      );
      return this.mapIssue(response.data, input.projectId);
    } catch (error) {
      throw httpError("GitLab", "create issue", error);
    }
  }

  /**
   * @description Comments on a GitLab issue
   * @summary `POST`s the comment body as a note to
   * `/projects/<projectId>/issues/<iid>/notes` and returns the note
   * identifier and its web URL. Requires a non-empty issue IID and body.
   * @param {object} input - The comment target and body.
   * @param {string} [input.projectId] - The project override; falls back to the configured `projectId`.
   * @param {number} input.iid - The issue's project-scoped IID.
   * @param {string} input.body - The comment body.
   * @returns {Promise<{id: number, webUrl?: string}>} The created note's ID and web URL.
   * @throws {InternalError} When the issue IID or body is empty, or the project ID cannot be resolved.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {ConflictError} When GitLab answers with HTTP 409.
   * @throws {BadRequestError} When GitLab answers with any other HTTP error status.
   */
  async commentOnIssue(input: {
    projectId?: string;
    iid: number;
    body: string;
  }): Promise<{ id: number; webUrl?: string }> {
    if (!input.iid || !input.body) {
      throw new InternalError(
        "GitLab comment requires an issue IID and body"
      );
    }
    try {
      const response = await this.client.post<{
        id?: number;
        web_url?: string;
      }>(
        `${this.projectPath(input.projectId)}/issues/${input.iid}/notes`,
        { body: input.body }
      );
      return { id: Number(response.data.id ?? 0), webUrl: response.data.web_url };
    } catch (error) {
      throw httpError("GitLab", "comment on issue", error);
    }
  }

  /**
   * @description Lists GitLab merge requests with state, search, and page filtering
   * @summary `GET`s `/projects/<projectId>/merge_requests` with a `state`
   * filter (default `"opened"`; `"all"` is sent as no state parameter),
   * a page size (`per_page`, default `30`), a page number, and a `search`
   * term. Merge requests are returned as raw GitLab payloads.
   * @param {GitlabListOptions} [options] - Project override, state, paging, and search options.
   * @returns {Promise<unknown[]>} The raw GitLab merge-request payloads.
   * @throws {InternalError} When the project ID cannot be resolved.
   * @throws {NotFoundError} When the project does not exist (HTTP 404).
   * @throws {ConflictError} When GitLab answers with HTTP 409.
   * @throws {BadRequestError} When GitLab answers with any other HTTP error status.
   */
  async listMergeRequests(
    options: GitlabListOptions = {}
  ): Promise<unknown[]> {
    try {
      const response = await this.client.get<unknown[]>(
        `${this.projectPath(options.projectId)}/merge_requests`,
        {
          params: {
            state: options.state === "all" ? undefined : options.state ?? "opened",
            per_page: options.limit ?? 30,
            page: options.page,
            search: options.search,
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("GitLab", "list merge requests", error);
    }
  }
}
