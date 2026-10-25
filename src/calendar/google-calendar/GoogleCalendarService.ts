/**
 * @module integrations/calendar/google-calendar/service
 * @summary Google Calendar API integration service for calendars and events.
 * @description Exposes Google Calendar `v3` operations (calendar list, event
 * list/get/create/update/delete) as an undecorated client-based service built
 * on {@link HttpApiService}. Configuration comes from an explicit
 * `GoogleCalendarServiceConfig` or the `calendar.googleCalendar` environment
 * slice. An OAuth access token is sent as a bearer token when present; an API
 * key is added as the `key` query parameter when no token is available. A
 * default `calendarId` may be configured and falls back to `"primary"`.
 * Credentials are referenced from configuration (and, from as-graph nodes, from
 * the resolved `google-calendar` credential secret) and are never embedded in
 * source. Failures are mapped to decaf errors via {@link httpError}.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { CalendarEnvironment } from "../environment";
import { envNumber, envString } from "../../shared/environmentValue";
import {
  HttpApiService,
  type HttpApiServiceConfig,
  httpError,
} from "../../shared/http";

/**
 * @description Configuration for the Google Calendar service
 * @summary Extends {@link HttpApiServiceConfig} with an optional OAuth
 * `token`, an optional `apiKey`, and a default `calendarId`. When omitted, the
 * `calendar.googleCalendar` environment slice supplies the same values (plus
 * optional `baseUrl`/`timeout`). At least one credential is required; the token
 * wins when both are set, and the calendar defaults to `"primary"`.
 * @category Calendar
 * @memberOf module:integrations/calendar/google-calendar/service
 */
export interface GoogleCalendarServiceConfig extends HttpApiServiceConfig {
  /**
   * @description Google OAuth access token
   * @summary Sent as `Authorization: Bearer <token>` when present.
   */
  token?: string;
  /**
   * @description Google API key
   * @summary Sent as the `key` query parameter only when no OAuth token is configured.
   */
  apiKey?: string;
  /**
   * @description Default calendar ID used when a call does not override it
   */
  calendarId?: string;
}

/**
 * @description Input for creating a Google Calendar event
 * @summary Carries the optional target `calendarId`, `summary`, optional
 * description and location, start/end values (date or date-time), an optional
 * time zone, and attendee email addresses.
 * @category Calendar
 * @memberOf module:integrations/calendar/google-calendar/service
 */
export interface GoogleCalendarEventInput {
  /**
   * @description Calendar ID (defaults to the configured value or `primary`)
   */
  calendarId?: string;
  /**
   * @description Event summary/title
   */
  summary: string;
  /**
   * @description Event description
   */
  description?: string;
  /**
   * @description Event location
   */
  location?: string;
  /**
   * @description Start date (`YYYY-MM-DD`) or date-time (ISO 8601)
   */
  start: string;
  /**
   * @description End date (`YYYY-MM-DD`) or date-time (ISO 8601)
   */
  end: string;
  /**
   * @description IANA time zone applied to date-time values
   */
  timeZone?: string;
  /**
   * @description Attendee email addresses
   */
  attendees?: string[];
}

/**
 * @description Input for listing Google Calendar events
 * @summary Carries the optional `calendarId` plus the time window, result cap,
 * free-text query, and single-events expansion flag.
 * @category Calendar
 * @memberOf module:integrations/calendar/google-calendar/service
 */
export interface GoogleCalendarListEventsInput {
  /**
   * @description Calendar ID (defaults to the configured value or `primary`)
   */
  calendarId?: string;
  /**
   * @description Lower bound for event start time (ISO 8601)
   */
  timeMin?: string;
  /**
   * @description Upper bound for event start time (ISO 8601)
   */
  timeMax?: string;
  /**
   * @description Maximum number of events to return
   */
  maxResults?: number;
  /**
   * @description Free-text search across event fields
   */
  q?: string;
  /**
   * @description Whether recurring events are expanded into instances
   */
  singleEvents?: boolean;
}

/**
 * @description Input for updating a Google Calendar event
 * @summary Carries the optional `calendarId` and the fields to change; omitted
 * fields are left untouched by the partial update.
 * @category Calendar
 * @memberOf module:integrations/calendar/google-calendar/service
 */
export interface GoogleCalendarEventUpdate {
  /**
   * @description Calendar ID (defaults to the configured value or `primary`)
   */
  calendarId?: string;
  /**
   * @description New event summary/title
   */
  summary?: string;
  /**
   * @description New event description
   */
  description?: string;
  /**
   * @description New event location
   */
  location?: string;
  /**
   * @description New start date or date-time
   */
  start?: string;
  /**
   * @description New end date or date-time
   */
  end?: string;
  /**
   * @description IANA time zone applied to date-time values
   */
  timeZone?: string;
  /**
   * @description Replacement attendee email addresses
   */
  attendees?: string[];
}

/**
 * @description Google Calendar API integration service
 * @summary An undecorated HTTP service for listing calendars and events and
 * for creating, reading, updating, and deleting events. Every operation needs
 * either an OAuth token or an API key; missing credentials or identifiers raise
 * `InternalError`, and transport failures are mapped to decaf errors via
 * {@link httpError}.
 * @class GoogleCalendarService
 * @extends HttpApiService
 * @category Calendar
 * @example
 * ```ts
 * import { GoogleCalendarService } from "@decaf-ts/integrations/calendar/google-calendar";
 *
 * const calendar = new GoogleCalendarService();
 * await calendar.initialize({
 *   token: process.env.GRAPH_CREDENTIAL_GOOGLE_CALENDAR_TOKEN,
 *   calendarId: "primary",
 * });
 * await calendar.listEvents({ timeMin: new Date().toISOString() });
 * ```
 * @mermaid
 * sequenceDiagram
 *   autonumber
 *   participant Caller
 *   participant Service as GoogleCalendarService
 *   participant API as Google Calendar API
 *   Caller->>Service: createEvent(input)
 *   activate Service
 *   Service->>Service: requireAuth()
 *   Service->>API: POST /calendars/{id}/events
 *   activate API
 *   API-->>Service: created event
 *   deactivate API
 *   Service-->>Caller: created event
 *   deactivate Service
 * @memberOf module:integrations/calendar/google-calendar/service
 */
export class GoogleCalendarService extends HttpApiService<GoogleCalendarServiceConfig> {
  /**
   * @description The provider name used in error messages
   */
  protected readonly serviceName = "Google Calendar";

  /**
   * @description The Google Calendar API base URL
   * @summary Used when the resolved config carries no `baseUrl`.
   * @returns {string} `"https://www.googleapis.com/calendar/v3"`.
   */
  protected defaultBaseUrl(): string {
    return "https://www.googleapis.com/calendar/v3";
  }

  /**
   * @description Builds the Google Calendar authorization headers
   * @summary Returns `Authorization: Bearer <token>` when an OAuth token is
   * configured, and no headers otherwise (API keys travel as query parameters).
   * @param {GoogleCalendarServiceConfig} config - The resolved service configuration.
   * @returns {Record<string, string>} The authorization headers (empty without a token).
   */
  protected authHeaders(
    config: GoogleCalendarServiceConfig
  ): Record<string, string> {
    if (config.token) return { Authorization: `Bearer ${config.token}` };
    return {};
  }

  /**
   * @description Reads the Google Calendar credentials and defaults from the environment
   * @summary Reads the `calendar.googleCalendar` slice and returns a partial
   * config when a token or API key is configured, `undefined` otherwise. Values
   * pass through `envString`/`envNumber` to reject unset-leaf proxies.
   * @returns {Partial<GoogleCalendarServiceConfig> | undefined} A partial config, or `undefined` when no credential is configured.
   */
  protected configFromEnvironment():
    | Partial<GoogleCalendarServiceConfig>
    | undefined {
    const env = CalendarEnvironment.calendar.googleCalendar;
    const token = envString(env?.token);
    const apiKey = envString(env?.apiKey);
    if (!token && !apiKey) return undefined;
    return {
      token,
      apiKey,
      calendarId: envString(env.calendarId),
      baseUrl: envString(env.baseUrl),
      timeout: envNumber(env.timeout),
    };
  }

  /**
   * @description Asserts that an OAuth token or API key is configured
   * @summary Called by every operation before it touches the network.
   * @returns {void}
   * @throws {InternalError} When neither a token nor an API key is configured.
   */
  protected requireAuth(): void {
    if (!this.config.token && !this.config.apiKey) {
      throw new InternalError(
        "Google Calendar requires an OAuth token or an API key"
      );
    }
  }

  /**
   * @description Builds API-key query parameters when no OAuth token is set
   * @summary Returns `{ key }` for API-key authentication, and an empty object
   * when an OAuth token is used (or no API key is configured).
   * @returns {Record<string, string>} The query parameters carrying the API key, if any.
   */
  private authParams(): Record<string, string> {
    return this.config.token || !this.config.apiKey
      ? {}
      : { key: this.config.apiKey };
  }

  /**
   * @description Builds the encoded events path for a calendar
   * @summary Resolves the calendar ID from the argument, the configured
   * default, or `"primary"`, then encodes it into
   * `/calendars/<id>/events`.
   * @param {string} [calendarId] - Optional per-call calendar ID.
   * @returns {string} The calendar events API path.
   */
  private calendarPath(calendarId?: string): string {
    const id = calendarId ?? this.config.calendarId ?? "primary";
    return `/calendars/${encodeURIComponent(id)}/events`;
  }

  /**
   * @description Builds the Google Calendar start/end object
   * @summary Emits `{ date }` for all-day values and `{ dateTime, timeZone? }`
   * for values containing a `T` separator.
   * @param {string} value - The date or date-time value.
   * @param {string} [timeZone] - Optional IANA time zone for date-time values.
   * @returns {Record<string, string>} The Calendar API time object.
   */
  private eventTime(
    value: string,
    timeZone?: string
  ): Record<string, string> {
    if (value.includes("T")) {
      return { dateTime: value, ...(timeZone ? { timeZone } : {}) };
    }
    return { date: value };
  }

  /**
   * @description Lists the calendars visible to the authenticated user
   * @summary `GET`s `/users/me/calendarList` and returns the calendar list.
   * @returns {Promise<unknown>} The calendar list payload.
   * @throws {InternalError} When no credential is configured.
   * @throws {BadRequestError} When Google rejects the request.
   */
  async listCalendars(): Promise<unknown> {
    this.requireAuth();
    try {
      const response = await this.client.get("/users/me/calendarList", {
        params: this.authParams(),
      });
      return response.data;
    } catch (error) {
      throw httpError("Google Calendar", "list calendars", error);
    }
  }

  /**
   * @description Lists events in a calendar
   * @summary `GET`s the calendar's events applying the optional time window,
   * result cap, free-text query, and single-events flag.
   * @param {GoogleCalendarListEventsInput} [input] - The calendar and event query options.
   * @returns {Promise<unknown>} The event collection payload.
   * @throws {InternalError} When no credential is configured.
   * @throws {NotFoundError} When the calendar does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the query.
   */
  async listEvents(
    input: GoogleCalendarListEventsInput = {}
  ): Promise<unknown> {
    this.requireAuth();
    try {
      const response = await this.client.get(
        this.calendarPath(input.calendarId),
        {
          params: {
            ...this.authParams(),
            ...(input.timeMin ? { timeMin: input.timeMin } : {}),
            ...(input.timeMax ? { timeMax: input.timeMax } : {}),
            ...(input.maxResults !== undefined
              ? { maxResults: input.maxResults }
              : {}),
            ...(input.q ? { q: input.q } : {}),
            ...(input.singleEvents !== undefined
              ? { singleEvents: input.singleEvents }
              : {}),
          },
        }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Calendar", "list events", error);
    }
  }

  /**
   * @description Creates a Google Calendar event
   * @summary `POST`s the event to the resolved calendar; start/end values are
   * normalized to Calendar time objects and attendees are mapped to
   * `{ email }` entries.
   * @param {GoogleCalendarEventInput} input - The event definition.
   * @returns {Promise<unknown>} The created event payload.
   * @throws {InternalError} When no credential is configured, or the summary, start, or end is missing.
   * @throws {NotFoundError} When the calendar does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the event.
   * @example
   * ```ts
   * await calendar.createEvent({
   *   summary: "Release review",
   *   start: "2026-11-01T09:00:00Z",
   *   end: "2026-11-01T10:00:00Z",
   *   attendees: ["team@example.com"],
   * });
   * ```
   */
  async createEvent(input: GoogleCalendarEventInput): Promise<unknown> {
    this.requireAuth();
    if (!input.summary || !input.start || !input.end) {
      throw new InternalError(
        "Google Calendar createEvent requires summary, start, and end"
      );
    }
    try {
      const response = await this.client.post(
        this.calendarPath(input.calendarId),
        {
          summary: input.summary,
          ...(input.description ? { description: input.description } : {}),
          ...(input.location ? { location: input.location } : {}),
          start: this.eventTime(input.start, input.timeZone),
          end: this.eventTime(input.end, input.timeZone),
          ...(input.attendees?.length
            ? { attendees: input.attendees.map((email) => ({ email })) }
            : {}),
        },
        { params: this.authParams() }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Calendar", "create event", error);
    }
  }

  /**
   * @description Fetches a single Google Calendar event
   * @summary `GET`s the event from the given calendar.
   * @param {string} calendarId - The calendar ID (empty falls back to the configured value or `primary`).
   * @param {string} eventId - The event ID.
   * @returns {Promise<unknown>} The event payload.
   * @throws {InternalError} When no credential is configured or the event ID is empty.
   * @throws {NotFoundError} When the event does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the request.
   */
  async getEvent(calendarId: string, eventId: string): Promise<unknown> {
    this.requireAuth();
    if (!eventId) {
      throw new InternalError("Google Calendar requires an event id");
    }
    try {
      const response = await this.client.get(
        `${this.calendarPath(calendarId)}/${encodeURIComponent(eventId)}`,
        { params: this.authParams() }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Calendar", "get event", error);
    }
  }

  /**
   * @description Partially updates a Google Calendar event
   * @summary `PATCH`es only the supplied fields on the event, normalizing
   * start/end and attendee values; omitted fields are left unchanged.
   * @param {string} eventId - The event ID to update.
   * @param {GoogleCalendarEventUpdate} input - The fields to change.
   * @returns {Promise<unknown>} The updated event payload.
   * @throws {InternalError} When no credential is configured or the event ID is empty.
   * @throws {NotFoundError} When the event does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the update.
   */
  async updateEvent(
    eventId: string,
    input: GoogleCalendarEventUpdate
  ): Promise<unknown> {
    this.requireAuth();
    if (!eventId) {
      throw new InternalError("Google Calendar requires an event id");
    }
    try {
      const response = await this.client.patch(
        `${this.calendarPath(input.calendarId)}/${encodeURIComponent(eventId)}`,
        {
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.location ? { location: input.location } : {}),
          ...(input.start
            ? { start: this.eventTime(input.start, input.timeZone) }
            : {}),
          ...(input.end
            ? { end: this.eventTime(input.end, input.timeZone) }
            : {}),
          ...(input.attendees?.length
            ? { attendees: input.attendees.map((email) => ({ email })) }
            : {}),
        },
        { params: this.authParams() }
      );
      return response.data;
    } catch (error) {
      throw httpError("Google Calendar", "update event", error);
    }
  }

  /**
   * @description Deletes a Google Calendar event
   * @summary `DELETE`s the event from the given calendar and returns
   * `{ deleted: true, eventId }`.
   * @param {string} calendarId - The calendar ID (empty falls back to the configured value or `primary`).
   * @param {string} eventId - The event ID to delete.
   * @returns {Promise<unknown>} `{ deleted: true, eventId }` on success.
   * @throws {InternalError} When no credential is configured or the event ID is empty.
   * @throws {NotFoundError} When the event does not exist (HTTP 404).
   * @throws {BadRequestError} When Google rejects the deletion.
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<unknown> {
    this.requireAuth();
    if (!eventId) {
      throw new InternalError("Google Calendar requires an event id");
    }
    try {
      await this.client.delete(
        `${this.calendarPath(calendarId)}/${encodeURIComponent(eventId)}`,
        { params: this.authParams() }
      );
      return { deleted: true, eventId };
    } catch (error) {
      throw httpError("Google Calendar", "delete event", error);
    }
  }
}
