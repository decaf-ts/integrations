import { LoggedEnvironment } from "@decaf-ts/logging";

/**
 * @module integrations/comms/environment
 * @summary Environment contract and accumulated environment for the comms integration services.
 * @description Declares the `CommsEnvironmentShape` consumed by the Slack,
 * Telegram, Teams, and Gmail services' `configFromEnvironment()` implementations and the
 * `CommsEnvironment` singleton created via `LoggedEnvironment.accumulate`.
 * Services read their credentials and defaults from the matching
 * `comms.<provider>` slice, using the `envString`/`envNumber` helpers from
 * `shared/environmentValue` to reject unset-leaf proxies.
 */
/**
 * @description Environment shape for the comms integration services
 * @summary Defines the `comms` root with one slice per provider (`slack`,
 * `telegram`, `teams`, `email`, `gmail`). Each slice carries the provider's
 * required credentials (e.g. `token`, `webhookUrl`) plus optional `baseUrl`
 * override and `timeout`. Fields are typed as required here so
 * `LoggedEnvironment.accumulate` registers them; absent values resolve to
 * proxy placeholders at runtime and must pass through `envString`/`envNumber`.
 * @memberOf module:integrations/comms/environment
 */
export interface CommsEnvironmentShape {
  comms: {
    slack: {
      token: string;
      baseUrl: string;
      timeout?: number;
    };
    telegram: {
      token: string;
      baseUrl: string;
      timeout?: number;
    };
    teams: {
      token: string;
      webhookUrl: string;
      baseUrl: string;
      timeout?: number;
    };
    email: {
      provider: string;
      host: string;
      port?: number;
      secure?: boolean;
      username: string;
      password: string;
      from: string;
      token: string;
      graphBaseUrl: string;
      timeout?: number;
    };
    gmail: {
      token: string;
      userId: string;
      baseUrl: string;
      timeout?: number;
    };
  };
}

/**
 * @description Accumulated comms environment singleton
 * @summary The `LoggedEnvironment.accumulate`-registered instance backing the
 * `CommsEnvironmentShape` contract. Comms services read their provider slice
 * (e.g. `CommsEnvironment.comms.slack`) inside `configFromEnvironment()` and
 * translate it into an `HttpApiServiceConfig`-derived config. Credentials come
 * from environment variables; for as-graph node usage those are provided as
 * `GRAPH_CREDENTIAL_*` values (placeholders in this example).
 * @example
 * ```ts
 * import { SlackService } from "@decaf-ts/integrations/comms/slack";
 *
 * // with comms.slack.token / comms.slack.baseUrl configured in the environment
 * const slack = new SlackService();
 * await slack.initialize();
 * ```
 * @constant {LoggedEnvironment} CommsEnvironment
 * @memberOf module:integrations/comms/environment
 */
export const CommsEnvironment = LoggedEnvironment.accumulate({
  comms: {
    slack: {
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    telegram: {
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    teams: {
      token: "",
      webhookUrl: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    email: {
      provider: "",
      host: "",
      port: undefined as unknown as number,
      secure: undefined as unknown as boolean,
      username: "",
      password: "",
      from: "",
      token: "",
      graphBaseUrl: "",
      timeout: undefined as unknown as number,
    },
    gmail: {
      token: "",
      userId: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
  },
} as CommsEnvironmentShape);
