export interface CalendarReminderOptions {
  /**
   * Standard 5-field cron:
   * minute hour day-of-month month day-of-week
   *
   * Examples:
   * "0 9 * * *"       Every day at 09:00
   * "0 9,21 * * *"    Every day at 09:00 and 21:00
   * "0 9 * * 1-5"     Weekdays at 09:00
   */
  cron: string;

  title: string;
  description?: string;
  location?: string;

  /**
   * First date from which occurrences should be calculated.
   * Defaults to now.
   */
  start?: Date;

  /**
   * IANA timezone, for example:
   * "Europe/Lisbon"
   */
  timezone?: string;

  /**
   * Length of each calendar event.
   * Defaults to 15 minutes.
   */
  durationMinutes?: number;

  /**
   * Calendar notification before every occurrence.
   * Defaults to 10 minutes.
   */
  alarmMinutesBefore?: number;

  /**
   * Maximum number of generated RDATE occurrences when the cron
   * expression cannot be converted into a single RRULE.
   */
  maxOccurrences?: number;

  /**
   * Do not generate occurrences after this date.
   */
  until?: Date;

  uid?: string;
  organizerEmail?: string;
  attendeeEmail?: string;
}

export interface CalendarFile {
  filename: string;
  content: string;
  mimeType: "text/calendar";
  bytes: Uint8Array;
}

export interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[] | null;
  month: number[] | null;
  dayOfWeek: number[] | null;
}

export interface RecurrenceResult {
  rrule?: string;
  rdates?: Date[];
}
