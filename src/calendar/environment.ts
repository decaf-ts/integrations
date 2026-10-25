/**
 * @module integrations/calendar/environment
 * @summary Environment contract and accumulated environment for the calendar integration services.
 * @description Declares the `CalendarEnvironmentShape` consumed by the Google
 * Calendar service's `configFromEnvironment()` implementation and the
 * `CalendarEnvironment` singleton created via `LoggedEnvironment.accumulate`.
 * Services read their credentials and defaults from the matching
 * `calendar.<provider>` slice, using the `envString`/`envNumber` helpers from
 * `shared/environmentValue` to reject unset-leaf proxies. The matching public
 * subpath export is `@decaf-ts/integrations/calendar/google-calendar`.
 */
import { LoggedEnvironment } from "@decaf-ts/logging";

/**
 * @description Environment shape for the calendar integration services
 * @summary Defines the `calendar` root with the `googleCalendar` slice. The
 * slice carries the OAuth `token` and/or `apiKey`, the default `calendarId`,
 * and an optional `baseUrl` override and `timeout`. Fields are typed as
 * required here so `LoggedEnvironment.accumulate` registers them; absent values
 * resolve to proxy placeholders at runtime and must pass through
 * `envString`/`envNumber`. Values are credential references supplied by the
 * environment, never literals embedded in source.
 * @memberOf module:integrations/calendar/environment
 */
export interface CalendarEnvironmentShape {
  calendar: {
    /** Google Calendar OAuth token/API key and default calendar (`calendar/google-calendar`). */
    googleCalendar: {
      token: string;
      apiKey: string;
      calendarId: string;
      baseUrl: string;
      timeout?: number;
    };
  };
}

/**
 * @description Accumulated calendar environment singleton
 * @summary The `LoggedEnvironment.accumulate`-registered instance backing the
 * `CalendarEnvironmentShape` contract. The Google Calendar service reads
 * `CalendarEnvironment.calendar.googleCalendar` inside
 * `configFromEnvironment()` and translates it into its
 * `HttpApiServiceConfig`-derived config. Credentials come from environment
 * variables; for as-graph node usage those are provided as
 * `GRAPH_CREDENTIAL_*` values (placeholders in this example).
 * @example
 * ```ts
 * import { GoogleCalendarService } from "@decaf-ts/integrations/calendar/google-calendar";
 *
 * // with calendar.googleCalendar.token / calendarId configured in the environment
 * const calendar = new GoogleCalendarService();
 * await calendar.initialize();
 * ```
 * @constant {LoggedEnvironment} CalendarEnvironment
 * @memberOf module:integrations/calendar/environment
 */
export const CalendarEnvironment = LoggedEnvironment.accumulate({
  calendar: {
    googleCalendar: {
      token: "",
      apiKey: "",
      calendarId: "",
      baseUrl: "",
      timeout: undefined as unknown as number,
    },
  },
} as CalendarEnvironmentShape);
