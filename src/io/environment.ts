import { LoggedEnvironment } from "@decaf-ts/logging";

/**
 * @module integrations/io/environment
 * @summary Environment contract and accumulated environment for the io integration services.
 * @description Declares the `IoEnvironmentShape` consumed by the Airtable,
 * Google Sheets, GraphQL, Microsoft Excel, Confluence, Jira, Google Docs, and
 * Microsoft SharePoint services' `configFromEnvironment()` implementations and
 * the `IoEnvironment` singleton created via `LoggedEnvironment.accumulate`.
 * Services read their credentials and defaults from the matching
 * `io.<provider>` slice, using the `envString`/`envNumber` helpers from
 * `shared/environmentValue` to reject unset-leaf proxies. The matching public
 * subpath exports are `@decaf-ts/integrations/io/microsoft-excel`,
 * `@decaf-ts/integrations/io/confluence`,
 * `@decaf-ts/integrations/io/jira`,
 * `@decaf-ts/integrations/io/google-docs`, and
 * `@decaf-ts/integrations/io/microsoft-sharepoint`.
 */
/**
 * @description Environment shape for the io integration services
 * @summary Defines the `io` root with one slice per provider (`airtable`,
 * `googleSheets`, `graphql`, `microsoftExcel`, `confluence`, `jira`,
 * `googleDocs`, `microsoftSharePoint`). Each slice carries the provider's
 * required credentials (`token`, plus `baseId`/`apiKey`/`endpoint`/`username`
 * where applicable) plus an optional `baseUrl` override and `timeout`. Fields
 * are typed as required here so `LoggedEnvironment.accumulate` registers them;
 * absent values resolve to proxy placeholders at runtime and must pass through
 * `envString`/`envNumber`. Values are credential references supplied by the
 * environment, never literals embedded in source.
 * @memberOf module:integrations/io/environment
 */
export interface IoEnvironmentShape {
  io: {
    airtable: {
      token: string;
      baseUrl: string;
      baseId: string;
      timeout?: number;
    };
    googleSheets: {
      token: string;
      apiKey: string;
      baseUrl: string;
      timeout?: number;
    };
    graphql: {
      endpoint: string;
      token: string;
      timeout?: number;
    };
    /** Microsoft Graph access token for Excel workbooks (`io/microsoft-excel`). */
    microsoftExcel: {
      token: string;
      baseUrl: string;
      timeout?: number;
    };
    /** Confluence API token, optional Basic-auth username, and site base URL (`io/confluence`). */
    confluence: {
      username: string;
      token: string;
      baseUrl: string;
      timeout?: number;
    };
    /** Jira API token, optional Basic-auth username, and site base URL (`io/jira`). */
    jira: {
      username: string;
      token: string;
      baseUrl: string;
      timeout?: number;
    };
    /** Google Docs OAuth token or API key (`io/google-docs`). */
    googleDocs: {
      token: string;
      apiKey: string;
      baseUrl: string;
      timeout?: number;
    };
    /** Microsoft Graph access token for SharePoint (`io/microsoft-sharepoint`). */
    microsoftSharePoint: {
      token: string;
      baseUrl: string;
      timeout?: number;
    };
  };
}

/**
 * @description Accumulated io environment singleton
 * @summary The `LoggedEnvironment.accumulate`-registered instance backing the
 * `IoEnvironmentShape` contract. IO services read their provider slice
 * (e.g. `IoEnvironment.io.airtable`) inside `configFromEnvironment()` and
 * translate it into an `HttpApiServiceConfig`-derived config. Credentials
 * come from environment variables; for as-graph node usage those are provided
 * as `GRAPH_CREDENTIAL_*` values (placeholders in this example).
 * @example
 * ```ts
 * import { AirtableService } from "@decaf-ts/integrations/io/airtable";
 *
 * // with io.airtable.token / io.airtable.baseId configured in the environment
 * const airtable = new AirtableService();
 * await airtable.initialize();
 * ```
 * @constant {LoggedEnvironment} IoEnvironment
 * @memberOf module:integrations/io/environment
 */
export const IoEnvironment = LoggedEnvironment.accumulate({
  io: {
    airtable: {
      token: "",
      baseUrl: "",
      baseId: "",
      timeout: undefined as unknown as number,
    },
    googleSheets: {
      token: "",
      apiKey: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    graphql: {
      endpoint: "",
      token: "",
      timeout: undefined as unknown as number,
    },
    microsoftExcel: {
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    confluence: {
      username: "",
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    jira: {
      username: "",
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    googleDocs: {
      token: "",
      apiKey: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
    microsoftSharePoint: {
      token: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
  },
} as IoEnvironmentShape);
