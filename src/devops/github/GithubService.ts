/**
 * @module integrations/devops/github/service
 * @summary GitHub REST API integration service for repositories, issues, and pull requests.
 * @description Exposes a focused subset of the GitHub REST API (`/repos/*`:
 * repository lookup, issue listing/creation/commenting, and pull-request
 * listing) as a decaf `@service("github")` client-based service built on
 * {@link HttpApiService}. Configuration comes from an explicit
 * `GithubServiceConfig` or the `devops.github` environment slice; repository
 * targets default to the configured `owner`/`repo` and can be overridden per
 * call. Raw GitHub responses are normalized to camelCase issue descriptors,
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
 * @description Configuration for the GitHub service
 * @summary Extends {@link HttpApiServiceConfig} with the GitHub personal
 * access token (sent as a bearer token with the GitHub API version headers)
 * and the default `owner`/`repo` used when a call does not override them.
 * When omitted, the `devops.github` environment slice supplies the token
 * (and optional `owner`, `repo`, `baseUrl`, `timeout`).
 * @category DevOps
 * @memberOf module:integrations/devops/github/service
 */
export interface GithubServiceConfig extends HttpApiServiceConfig {
  /**
   * @description GitHub personal access token
   * @summary Sent as `Authorization: Bearer <token>` with every API call.
   */
  token?: string;
  /**
   * @description Default repository owner used when a call does not override it
   */
  owner?: string;
  /**
   * @description Default repository name used when a call does not override it
   */
  repo?: string;
}

/**
 * @description Repository targeting reference
 * @summary Carries the optional `owner`/`repo` override for a single call;
 * when either field is omitted the service falls back to the configured
 * `GithubServiceConfig.owner`/`repo`. Operations that cannot resolve both
 * values throw `InternalError`.
 * @category DevOps
 * @memberOf module:integrations/devops/github/service
 */
export interface GithubRepositoryRef {
  /**
   * @description Repository owner for this call
   */
  owner?: string;
  /**
   * @description Repository name for this call
   */
  repo?: string;
}

/**
 * @description Input for creating a GitHub issue
 * @summary Extends {@link GithubRepositoryRef} with the required issue
 * `title` and the optional body, labels, assignees, and milestone number.
 * @category DevOps
 * @memberOf module:integrations/devops/github/service
 */
export interface GithubIssueInput extends GithubRepositoryRef {
  /**
   * @description Issue title (required by the GitHub API)
   */
  title: string;
  /**
   * @description Issue body in markdown
   */
  body?: string;
  /**
   * @description Label names to apply
   */
  labels?: string[];
  /**
   * @description Usernames to assign
   */
  assignees?: string[];
  /**
   * @description Milestone number to associate
   */
  milestone?: number;
}

/**
 * @description Normalized GitHub issue descriptor
 * @summary Maps the raw GitHub issue payload onto camelCase fields: identity
 * (`number`, `title`, `state`), `htmlUrl`, body and author, `labels` (label
 * names only), `comments` count, and `createdAt`/`updatedAt` timestamps.
 * Pull requests returned by the issues endpoint are filtered out.
 * @category DevOps
 * @memberOf module:integrations/devops/github/service
 */
export interface GithubIssue extends GithubRepositoryRef {
  number: number;
  title: string;
  state?: string;
  htmlUrl?: string;
  body?: string;
  user?: string;
  labels?: string[];
  comments?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Undocumented duplicate of {@link GithubListOptions} below; identical members
 * merge silently. Flagged for removal by the delivery owner.
 */
export interface GithubListOptions extends GithubRepositoryRef {
  state?: "open" | "closed" | "all";
  limit?: number;
  page?: number;
  labels?: string;
}

/**
 * @description Options for listing GitHub issues or pull requests
 * @summary Extends {@link GithubRepositoryRef} with the issue/PR `state`
 * filter, a page size (`limit`) and `page` number for paging, and a
 * comma-separated `labels` filter applied to issue listings.
 * @category DevOps
 * @memberOf module:integrations/devops/github/service
 */
export interface GithubListOptions extends GithubRepositoryRef {
  /**
   * @description Issue/PR state filter
   */
  state?: "open" | "closed" | "all";
  /**
   * @description Page size (GitHub's `per_page`); defaults to `30`
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
}

/**
 * @description GitHub REST API integration service
 * @summary A decaf `@service("github")` HTTP service for looking up
 * repositories, listing issues (excluding pull requests), creating issues,
 * commenting on issues, and listing pull requests. Repository targets resolve
 * per call from the input's `owner`/`repo`, falling back to the configured
 * config values, and throw `InternalError` when unresolved. The token is sent
 * as a bearer token with the GitHub `Accept` and API-version headers, and
 * transport failures are mapped to decaf errors via {@link httpError}.
 * @class GithubService
 * @category DevOps
 * @example
 * ```ts
 * import { GithubService } from "@decaf-ts/integrations/devops/github";
 *
 * const github = new GithubService();
 * await github.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_GITHUB_TOKEN,
 *   owner: "example-org",
 *   repo: "example-repo",
 * });
 * const issue = await github.createIssue({
 *   title: "Bug report",
 *   body: "Something is broken",
 *   labels: ["bug"],
 * });
 * ```
 * @memberOf module:integrations/devops/github/service
 */
@service("github")
export class GithubService extends HttpApiService<GithubServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "GitHub";

  /**
   * @description The GitHub REST API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://api.github.com"`.
   */
  protected defaultBaseUrl(): string {
    return "https://api.github.com";
  }

  /**
   * @description Builds the GitHub authentication and API version headers
   * @summary Returns `Authorization: Bearer <token>`, the GitHub JSON
   * `Accept` header, and the `X-GitHub-Api-Version` header when the config
   * carries a token; without a token only the `Accept` headers are sent.
   * @param {GithubServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization and version headers.
   */
  protected authHeaders(config: GithubServiceConfig): Record<string, string> {
    return config.token
      ? {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        }
      : { Accept: "application/vnd.github+json" };
  }

  /**
   * @description Reads the GitHub credentials and defaults from the environment
   * @summary Reads the `devops.github` environment slice and returns a
   * partial config when a token is configured, `undefined` otherwise. Values
   * pass through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<GithubServiceConfig> | undefined} A partial config, or `undefined` when no GitHub token is configured.
   */
  protected configFromEnvironment(): Partial<GithubServiceConfig> | undefined {
    const env = DevopsEnvironment.devops.github;
    const token = envString(env?.token);
    if (!token) return undefined;
    return {
      token,
      owner: envString(env.owner),
      repo: envString(env.repo),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Resolves the URL-encoded repository path for a call
   * @summary Builds `/repos/<owner>/<repo>` from the input's `owner`/`repo`,
   * falling back to the configured config values, and throws when either
   * value is missing.
   * @param {GithubRepositoryRef} [input] - The per-call repository override.
   * @returns {string} The URL-encoded repository API path.
   * @throws {InternalError} When neither the input nor the config yields an owner and repository.
   */
  protected repoPath(input: GithubRepositoryRef = {}): string {
    const owner = input.owner ?? this.config.owner;
    const repo = input.repo ?? this.config.repo;
    if (!owner || !repo) {
      throw new InternalError("GitHub requires an owner and repository");
    }
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  /**
   * @description Normalizes a raw GitHub issue payload
   * @summary Maps the raw issue JSON onto a {@link GithubIssue}: label objects
   * are reduced to names, the author to its `login`, and numeric/string
   * fields are coerced. The repository reference is echoed from the input,
   * falling back to the configured `owner`/`repo`.
   * @param {Record<string, unknown>} raw - The raw GitHub issue payload.
   * @param {GithubRepositoryRef} ref - The repository reference the issue belongs to.
   * @returns {GithubIssue} The normalized issue descriptor.
   */
  protected mapIssue(
    raw: Record<string, unknown>,
    ref: GithubRepositoryRef
  ): GithubIssue {
    return {
      owner: ref.owner ?? this.config.owner,
      repo: ref.repo ?? this.config.repo,
      number: Number(raw["number"] ?? 0),
      title: String(raw["title"] ?? ""),
      state: envString(raw["state"]),
      htmlUrl: envString(raw["html_url"]),
      body: envString(raw["body"]),
      user: envString((raw["user"] as { login?: string } | undefined)?.login),
      labels: Array.isArray(raw["labels"])
        ? (raw["labels"] as Array<{ name?: string } | string>).map((label) =>
            typeof label === "string" ? label : String(label.name ?? "")
          )
        : undefined,
      comments:
        typeof raw["comments"] === "number"
          ? (raw["comments"] as number)
          : undefined,
      createdAt: envString(raw["created_at"]),
      updatedAt: envString(raw["updated_at"]),
    };
  }

  /**
   * @description Fetches a GitHub repository
   * @summary `GET`s `/repos/<owner>/<repo>` for the given reference (falling
   * back to the configured `owner`/`repo`) and returns the raw repository
   * payload.
   * @param {GithubRepositoryRef} [ref] - The repository to look up; defaults to the configured `owner`/`repo`.
   * @returns {Promise<unknown>} The raw GitHub repository payload.
   * @throws {InternalError} When the repository reference cannot be resolved.
   * @throws {NotFoundError} When the repository does not exist (HTTP 404).
   * @throws {ConflictError} When GitHub answers with HTTP 409.
   * @throws {BadRequestError} When GitHub answers with any other HTTP error status.
   */
  async getRepository(ref: GithubRepositoryRef = {}): Promise<unknown> {
    try {
      const response = await this.client.get(this.repoPath(ref));
      return response.data;
    } catch (error) {
      throw httpError("GitHub", "get repository", error);
    }
  }

  /**
   * @description Lists GitHub issues with state, label, and page filtering
   * @summary `GET`s `/repos/<owner>/<repo>/issues` with a `state` filter
   * (default `"open"`), a page size (`per_page`, default `30`), a page
   * number, and a comma-separated `labels` filter. Entries carrying a
   * `pull_request` key are filtered out so only true issues are returned.
   * @param {GithubListOptions} [options] - Repository override, state, paging, and label options.
   * @returns {Promise<GithubIssue[]>} The normalized issues for the requested page.
   * @throws {InternalError} When the repository reference cannot be resolved.
   * @throws {NotFoundError} When the repository does not exist (HTTP 404).
   * @throws {ConflictError} When GitHub answers with HTTP 409.
   * @throws {BadRequestError} When GitHub answers with any other HTTP error status.
   * @example
   * ```ts
   * let page = 1;
   * for (;;) {
   *   const issues = await github.listIssues({
   *     state: "open",
   *     labels: "bug,priority:high",
   *     limit: 50,
   *     page,
   *   });
   *   if (issues.length === 0) break;
   *   page += 1;
   * }
   * ```
   */
  async listIssues(
    options: GithubListOptions = {}
  ): Promise<GithubIssue[]> {
    try {
      const response = await this.client.get<Array<Record<string, unknown>>>(
        `${this.repoPath(options)}/issues`,
        {
          params: {
            state: options.state ?? "open",
            per_page: options.limit ?? 30,
            page: options.page,
            labels: options.labels,
          },
        }
      );
      return response.data
        .filter((entry) => !entry["pull_request"])
        .map((entry) => this.mapIssue(entry, options));
    } catch (error) {
      throw httpError("GitHub", "list issues", error);
    }
  }

  /**
   * @description Creates a GitHub issue
   * @summary `POST`s the title, body, labels, assignees, and milestone to
   * `/repos/<owner>/<repo>/issues` and returns the normalized issue
   * descriptor. Requires a non-empty `title` and a resolvable repository
   * reference.
   * @param {GithubIssueInput} input - The issue content and repository targeting.
   * @returns {Promise<GithubIssue>} The normalized created issue.
   * @throws {InternalError} When the title is empty or the repository reference cannot be resolved.
   * @throws {NotFoundError} When the repository does not exist (HTTP 404).
   * @throws {ConflictError} When GitHub answers with HTTP 409.
   * @throws {BadRequestError} When GitHub answers with any other HTTP error status (e.g. invalid labels or assignees).
   */
  async createIssue(input: GithubIssueInput): Promise<GithubIssue> {
    if (!input.title) {
      throw new InternalError("GitHub issue requires a title");
    }
    try {
      const response = await this.client.post<Record<string, unknown>>(
        `${this.repoPath(input)}/issues`,
        {
          title: input.title,
          body: input.body,
          labels: input.labels,
          assignees: input.assignees,
          milestone: input.milestone,
        }
      );
      return this.mapIssue(response.data, input);
    } catch (error) {
      throw httpError("GitHub", "create issue", error);
    }
  }

  /**
   * @description Comments on a GitHub issue
   * @summary `POST`s the comment body to
   * `/repos/<owner>/<repo>/issues/<number>/comments` and returns the comment
   * identifier and its HTML URL. Requires a non-empty issue number and body.
   * @param {GithubRepositoryRef & {number: number, body: string}} input - The repository targeting, issue number, and comment body.
   * @returns {Promise<{id: number, htmlUrl?: string}>} The created comment's ID and HTML URL.
   * @throws {InternalError} When the issue number or body is empty, or the repository reference cannot be resolved.
   * @throws {NotFoundError} When the issue does not exist (HTTP 404).
   * @throws {ConflictError} When GitHub answers with HTTP 409.
   * @throws {BadRequestError} When GitHub answers with any other HTTP error status.
   */
  async commentOnIssue(
    input: GithubRepositoryRef & { number: number; body: string }
  ): Promise<{ id: number; htmlUrl?: string }> {
    if (!input.number || !input.body) {
      throw new InternalError(
        "GitHub comment requires an issue number and body"
      );
    }
    try {
      const response = await this.client.post<{
        id?: number;
        html_url?: string;
      }>(`${this.repoPath(input)}/issues/${input.number}/comments`, {
        body: input.body,
      });
      return { id: Number(response.data.id ?? 0), htmlUrl: response.data.html_url };
    } catch (error) {
      throw httpError("GitHub", "comment on issue", error);
    }
  }

  /**
   * @description Lists GitHub pull requests with state and page filtering
   * @summary `GET`s `/repos/<owner>/<repo>/pulls` with a `state` filter
   * (default `"open"`), a page size (`per_page`, default `30`), and a page
   * number. Pull requests are returned as raw GitHub payloads.
   * @param {GithubListOptions} [options] - Repository override, state, and paging options.
   * @returns {Promise<unknown[]>} The raw GitHub pull-request payloads.
   * @throws {InternalError} When the repository reference cannot be resolved.
   * @throws {NotFoundError} When the repository does not exist (HTTP 404).
   * @throws {ConflictError} When GitHub answers with HTTP 409.
   * @throws {BadRequestError} When GitHub answers with any other HTTP error status.
   */
  async listPullRequests(
    options: GithubListOptions = {}
  ): Promise<unknown[]> {
    try {
      const response = await this.client.get<unknown[]>(
        `${this.repoPath(options)}/pulls`,
        {
          params: {
            state: options.state ?? "open",
            per_page: options.limit ?? 30,
            page: options.page,
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("GitHub", "list pull requests", error);
    }
  }
}
