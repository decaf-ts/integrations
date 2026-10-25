import { LoggedEnvironment } from "@decaf-ts/logging";

/**
 * @module integrations/comms/environment
 * @summary Environment contract and accumulated environment for the comms integration services.
 * @description Declares the `CommsEnvironmentShape` consumed by the Slack,
 * Telegram, Teams, Gmail, Discord, WhatsApp, and Outlook services'
 * `configFromEnvironment()` implementations and the `CommsEnvironment`
 * singleton created via `LoggedEnvironment.accumulate`. Services read their
 * credentials and defaults from the matching `comms.<provider>` slice, using
 * the `envString`/`envNumber` helpers from `shared/environmentValue` to reject
 * unset-leaf proxies. The matching public subpath exports are
 * `@decaf-ts/integrations/comms/discord`,
 * `@decaf-ts/integrations/comms/whatsapp`, and
 * `@decaf-ts/integrations/comms/outlook`.
 */
/**
 * @description Environment shape for the comms integration services
 * @summary Defines the `comms` root with one slice per provider (`slack`,
 * `telegram`, `teams`, `email`, `gmail`, `discord`, `whatsApp`, `outlook`).
 * Each slice carries the provider's required credentials (e.g. `token`,
 * `webhookUrl`, `phoneNumberId`) plus optional `baseUrl` override and
 * `timeout`. Fields are typed as required here so
 * `LoggedEnvironment.accumulate` registers them; absent values resolve to
 * proxy placeholders at runtime and must pass through `envString`/`envNumber`.
 * Values are credential references supplied by the environment, never literals
 * embedded in source.
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
      /** Explicit opt-in for SMTP AUTH over a plaintext session (default false). */
      allowPlaintextAuth?: boolean;
      timeout?: number;
    };
    gmail: {
      token: string;
      userId: string;
      baseUrl: string;
      timeout?: number;
    };
    /** Discord bot token and optional API overrides (`comms/discord`). */
    discord: {
      token: string;
      baseUrl: string;
      timeout?: number;
    };
    /** WhatsApp Cloud API token and sender phone number ID (`comms/whatsapp`). */
    whatsApp: {
      token: string;
      phoneNumberId: string;
      baseUrl: string;
      timeout?: number;
    };
    /** Microsoft Graph access token for Outlook mail/calendar (`comms/outlook`). */
    outlook: {
      token: string;
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
    discord: {
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    whatsApp: {
      token: "",
      phoneNumberId: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    outlook: {
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
  },
} as CommsEnvironmentShape);
