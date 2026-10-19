import { LoggedEnvironment } from "@decaf-ts/logging";

/**
 * @module integrations/devops/environment
 * @summary Environment contract and accumulated environment for the devops integration services.
 * @description Declares the `DevopsEnvironmentShape` consumed by the GitHub and
 * GitLab services' `configFromEnvironment()` implementations and the
 * `DevopsEnvironment` singleton created via `LoggedEnvironment.accumulate`.
 * Services read their credentials and defaults from the matching
 * `devops.<provider>` slice, using the `envString`/`envNumber` helpers from
 * `shared/environmentValue` to reject unset-leaf proxies.
 */
/**
 * @description Environment shape for the devops integration services
 * @summary Defines the `devops` root with one slice per provider (`github`,
 * `gitlab`). Each slice carries the provider's required `token` and defaults
 * (`owner`/`repo` for GitHub, `projectId` for GitLab) plus an optional
 * `baseUrl` override and `timeout`. Fields are typed as required here so
 * `LoggedEnvironment.accumulate` registers them; absent values resolve to
 * proxy placeholders at runtime and must pass through `envString`/`envNumber`.
 * @memberOf module:integrations/devops/environment
 */
export interface DevopsEnvironmentShape {
  devops: {
    github: {
      token: string;
      baseUrl: string;
      owner: string;
      repo: string;
      timeout?: number;
    };
    gitlab: {
      token: string;
      baseUrl: string;
      projectId: string;
      timeout?: number;
    };
  };
}

/**
 * @description Accumulated devops environment singleton
 * @summary The `LoggedEnvironment.accumulate`-registered instance backing the
 * `DevopsEnvironmentShape` contract. Devops services read their provider
 * slice (e.g. `DevopsEnvironment.devops.github`) inside
 * `configFromEnvironment()` and translate it into an
 * `HttpApiServiceConfig`-derived config. Credentials come from environment
 * variables; for as-graph node usage those are provided as
 * `GRAPH_CREDENTIAL_*` values (placeholders in this example).
 * @example
 * ```ts
 * import { GithubService } from "@decaf-ts/integrations/devops/github";
 *
 * // with devops.github.token / devops.github.owner / devops.github.repo configured
 * const github = new GithubService();
 * await github.initialize();
 * ```
 * @constant {LoggedEnvironment} DevopsEnvironment
 * @memberOf module:integrations/devops/environment
 */
export const DevopsEnvironment = LoggedEnvironment.accumulate({
  devops: {
    github: {
      token: "",
      baseUrl: "",
      owner: "",
      repo: "",
      timeout: undefined as unknown as number,
    },
    gitlab: {
      token: "",
      baseUrl: "",
      projectId: "",
      timeout: undefined as unknown as number,
    },
  },
} as DevopsEnvironmentShape);
