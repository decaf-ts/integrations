import { Context, MaybeContextualArg, service, Service } from "@decaf-ts/core";
import { CronExpressionParser } from "cron-parser";
import {
  CalendarFile,
  CalendarReminderOptions,
  ParsedCron,
  RecurrenceResult,
} from "./types";
import { OperationKeys, ValidationError } from "@decaf-ts/db-decorators";
import { type ICalendarWriter } from "./writers/ICalendarWriter";
import { inject } from "@decaf-ts/injectable-decorators";

/**
 * Creates interoperable iCalendar medication reminders.
 *
 * The service has no static Node imports, so the same module can be bundled
 * for browsers. Node-only filesystem behavior is loaded dynamically.
 */
@service()
export class CalendarService extends Service {
  @inject('"calendar-writer"')
  protected writer!: ICalendarWriter;

  public async createMedicationReminder(
    options: CalendarReminderOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<CalendarFile> {
    const { log, ctx } = (
      await this.logCtx(args, OperationKeys.CREATE, true)
    ).for(this.createMedicationReminder);
    this.validateOptions(options);

    const start = options.start ? new Date(options.start) : new Date();

    const timezone =
      options.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC";

    const durationMinutes = options.durationMinutes ?? 15;
    const alarmMinutesBefore = options.alarmMinutesBefore ?? 10;
    const uid = options.uid ?? this.createUid();

    const recurrence = this.createRecurrence(options, start, timezone, ctx);

    const firstOccurrence =
      recurrence.rdates?.[0] ??
      this.getFirstOccurrence(options.cron, start, timezone);

    const end = new Date(firstOccurrence.getTime() + durationMinutes * 60_000);

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "PRODID:-//PTP//Calendar Service//EN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${this.escapeProperty(uid)}`,
      `DTSTAMP:${this.formatUtcDate(new Date())}`,
      `DTSTART;TZID=${this.escapeParameter(timezone)}:${this.formatLocalDate(
        firstOccurrence,
        timezone
      )}`,
      `DTEND;TZID=${this.escapeParameter(timezone)}:${this.formatLocalDate(
        end,
        timezone
      )}`,
      `SUMMARY:${this.escapeText(options.title)}`,
    ];

    if (options.description) {
      lines.push(`DESCRIPTION:${this.escapeText(options.description)}`);
    }

    if (options.location) {
      lines.push(`LOCATION:${this.escapeText(options.location)}`);
    }

    if (recurrence.rrule) {
      lines.push(`RRULE:${recurrence.rrule}`);
    }

    if (recurrence.rdates && recurrence.rdates.length > 1) {
      // DTSTART already represents the first occurrence.
      const remaining = recurrence.rdates.slice(1);

      lines.push(...this.createFoldedRDateLines(remaining, timezone));
    }

    if (options.organizerEmail) {
      lines.push(
        `ORGANIZER:mailto:${this.escapeProperty(options.organizerEmail)}`
      );
    }

    if (options.attendeeEmail) {
      lines.push(
        [
          "ATTENDEE",
          "CUTYPE=INDIVIDUAL",
          "ROLE=REQ-PARTICIPANT",
          "PARTSTAT=NEEDS-ACTION",
          "RSVP=TRUE",
        ].join(";") + `:mailto:${this.escapeProperty(options.attendeeEmail)}`
      );
    }

    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:-PT${alarmMinutesBefore}M`,
      `DESCRIPTION:${this.escapeText(options.title)}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    );

    const content = this.foldLines(lines).join("\r\n") + "\r\n";
    const filename = this.createFilename(options.title);

    log.verbose(`Calendar event created: ${filename}`);
    log.debug(`Content for ${filename}: ${content}`);

    return {
      filename,
      content,
      mimeType: "text/calendar",
      bytes: new TextEncoder().encode(content),
    };
  }

  public async createAndStoreReminder(
    options: CalendarReminderOptions,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { ctx } = (await this.logCtx(args, OperationKeys.CREATE, true)).for(
      this.createAndStoreReminder
    );

    const file = await this.createMedicationReminder(options, ctx);

    await this.writer.write(file, ctx);
  }

  private createRecurrence(
    options: CalendarReminderOptions,
    start: Date,
    timezone: string,
    ctx: Context<any>
  ): RecurrenceResult {
    const parsed = this.parseSimpleCron(options.cron, ctx);
    const until = options.until ? this.formatUtcDate(options.until) : undefined;

    if (parsed) {
      const rrule = this.convertSimpleCronToRRule(parsed, until);

      if (rrule) {
        return { rrule };
      }
    }

    return {
      rdates: this.expandCronDates(
        options.cron,
        start,
        timezone,
        options.maxOccurrences ?? 365,
        options.until
      ),
    };
  }

  /**
   * Converts the commonly needed medication schedules.
   *
   * Unsupported cron shapes fall back to explicit RDATE occurrences.
   */
  private convertSimpleCronToRRule(
    cron: ParsedCron,
    until?: string
  ): string | undefined {
    const suffix = until ? `;UNTIL=${until}` : "";

    const minutes = cron.minute.join(",");
    const hours = cron.hour.join(",");

    const timeParts = `BYHOUR=${hours};BYMINUTE=${minutes};BYSECOND=0`;

    const everyDay =
      cron.dayOfMonth === null &&
      cron.month === null &&
      cron.dayOfWeek === null;

    if (everyDay) {
      return `FREQ=DAILY;${timeParts}${suffix}`;
    }

    const weekly =
      cron.dayOfMonth === null &&
      cron.month === null &&
      cron.dayOfWeek !== null;

    if (weekly) {
      const weekdays = cron
        .dayOfWeek!.map((day) => this.weekdayToIcs(day))
        .join(",");

      return `FREQ=WEEKLY;BYDAY=${weekdays};${timeParts}${suffix}`;
    }

    const monthly =
      cron.dayOfMonth !== null &&
      cron.month === null &&
      cron.dayOfWeek === null;

    if (monthly) {
      return (
        `FREQ=MONTHLY;BYMONTHDAY=${cron.dayOfMonth!.join(",")};` +
        `${timeParts}${suffix}`
      );
    }

    const yearly =
      cron.dayOfMonth !== null &&
      cron.month !== null &&
      cron.dayOfWeek === null;

    if (yearly) {
      return (
        `FREQ=YEARLY;BYMONTH=${cron.month!.join(",")};` +
        `BYMONTHDAY=${cron.dayOfMonth!.join(",")};` +
        `${timeParts}${suffix}`
      );
    }

    // Cron day-of-month/day-of-week combinations have OR-like semantics
    // in many implementations and cannot be represented safely as one RRULE.
    return undefined;
  }

  private parseSimpleCron(
    expression: string,
    ctx: Context<any>
  ): ParsedCron | undefined {
    const { log } = this.logCtx([ctx], this.parseSimpleCron);
    const fields = expression.trim().split(/\s+/);

    if (fields.length !== 5) {
      return undefined;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

    try {
      return {
        minute: this.parseCronField(minute, 0, 59, ctx),
        hour: this.parseCronField(hour, 0, 23, ctx),
        dayOfMonth:
          dayOfMonth === "*"
            ? null
            : this.parseCronField(dayOfMonth, 1, 31, ctx),
        month: month === "*" ? null : this.parseCronField(month, 1, 12, ctx),
        dayOfWeek:
          dayOfWeek === "*"
            ? null
            : this.parseCronField(dayOfWeek, 0, 7, ctx).map((value) =>
                value === 7 ? 0 : value
              ),
      };
    } catch {
      log.debug(`Failed to generate simple cron expression for ${expression}`);
      return undefined;
    }
  }

  private parseCronField(
    field: string,
    minimum: number,
    maximum: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: Context<any>
  ): number[] {
    const values = new Set<number>();

    for (const segment of field.split(",")) {
      const [rangeExpression, stepExpression] = segment.split("/");

      const step =
        stepExpression === undefined ? 1 : Number.parseInt(stepExpression, 10);

      if (!Number.isInteger(step) || step <= 0) {
        throw new ValidationError(`Invalid cron step: ${segment}`);
      }

      let start: number;
      let end: number;

      if (rangeExpression === "*") {
        start = minimum;
        end = maximum;
      } else if (rangeExpression.includes("-")) {
        const bounds = rangeExpression.split("-");

        if (bounds.length !== 2) {
          throw new ValidationError(`Invalid cron range: ${segment}`);
        }

        start = Number.parseInt(bounds[0], 10);
        end = Number.parseInt(bounds[1], 10);
      } else {
        start = Number.parseInt(rangeExpression, 10);
        end = start;
      }

      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < minimum ||
        end > maximum ||
        start > end
      ) {
        throw new ValidationError(`Invalid cron field: ${segment}`);
      }

      for (let value = start; value <= end; value += step) {
        values.add(value);
      }
    }

    return [...values].sort((a, b) => a - b);
  }

  private expandCronDates(
    cron: string,
    start: Date,
    timezone: string,
    maximum: number,
    until?: Date
  ): Date[] {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: start,
      tz: timezone,
    });

    const occurrences: Date[] = [];

    while (occurrences.length < maximum) {
      const next = interval.next().toDate();

      if (until && next > until) {
        break;
      }

      occurrences.push(next);
    }

    if (occurrences.length === 0) {
      throw new Error(
        "The cron expression produced no occurrences in the requested range."
      );
    }

    return occurrences;
  }

  private getFirstOccurrence(
    cron: string,
    start: Date,
    timezone: string
  ): Date {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: start,
      tz: timezone,
    });

    return interval.next().toDate();
  }

  private createFoldedRDateLines(dates: Date[], timezone: string): string[] {
    const prefix = `RDATE;TZID=${this.escapeParameter(timezone)}:`;

    const values = dates.map((date) => this.formatLocalDate(date, timezone));

    // Keep each logical property reasonably sized before RFC line folding.
    const result: string[] = [];
    let current = prefix;

    for (const value of values) {
      const candidate =
        current === prefix ? `${current}${value}` : `${current},${value}`;

      if (new TextEncoder().encode(candidate).length > 700) {
        result.push(current);
        current = `${prefix}${value}`;
      } else {
        current = candidate;
      }
    }

    if (current !== prefix) {
      result.push(current);
    }

    return result;
  }

  private formatUtcDate(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  }

  private formatLocalDate(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    return (
      `${values.year}${values.month}${values.day}` +
      `T${values.hour}${values.minute}${values.second}`
    );
  }

  private foldLines(lines: string[]): string[] {
    return lines.flatMap((line) => this.foldLine(line));
  }

  /**
   * RFC 5545 content lines should be folded at 75 octets.
   */
  private foldLine(line: string): string[] {
    const encoder = new TextEncoder();
    const result: string[] = [];
    let remaining = line;
    let first = true;

    while (encoder.encode(first ? remaining : ` ${remaining}`).length > 75) {
      const prefix = first ? "" : " ";
      let chunk = "";
      let consumed = 0;

      for (const character of remaining) {
        const candidate = `${prefix}${chunk}${character}`;

        if (encoder.encode(candidate).length > 75) {
          break;
        }

        chunk += character;
        consumed += character.length;
      }

      if (!chunk) {
        throw new Error("Unable to fold iCalendar content line.");
      }

      result.push(`${prefix}${chunk}`);
      remaining = remaining.slice(consumed);
      first = false;
    }

    result.push(first ? remaining : ` ${remaining}`);

    return result;
  }

  private escapeText(value: string): string {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  private escapeProperty(value: string): string {
    return value.replace(/[\r\n]/g, "");
  }

  private escapeParameter(value: string): string {
    if (!/^[A-Za-z0-9_+./-]+$/.test(value)) {
      throw new ValidationError(`Unsafe iCalendar parameter: ${value}`);
    }

    return value;
  }

  private weekdayToIcs(day: number): string {
    const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const result = days[day];

    if (!result) {
      throw new ValidationError(`Invalid weekday: ${day}`);
    }

    return result;
  }

  private createUid(): string {
    const random =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return `${random}@calendar-service`;
  }

  private createFilename(title: string): string {
    const safeTitle = title
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();

    return `${safeTitle || "calendar-reminder"}.ics`;
  }

  private validateOptions(options: CalendarReminderOptions): void {
    if (!options.cron?.trim()) {
      throw new ValidationError("A cron expression is required.");
    }

    if (!options.title?.trim()) {
      throw new ValidationError("A calendar title is required.");
    }

    if (
      options.durationMinutes !== undefined &&
      (!Number.isFinite(options.durationMinutes) ||
        options.durationMinutes <= 0)
    ) {
      throw new ValidationError("durationMinutes must be greater than zero.");
    }

    if (
      options.alarmMinutesBefore !== undefined &&
      (!Number.isInteger(options.alarmMinutesBefore) ||
        options.alarmMinutesBefore < 0)
    ) {
      throw new ValidationError(
        "alarmMinutesBefore must be a non-negative integer."
      );
    }

    if (
      options.maxOccurrences !== undefined &&
      (!Number.isInteger(options.maxOccurrences) || options.maxOccurrences <= 0)
    ) {
      throw new ValidationError("maxOccurrences must be a positive integer.");
    }
  }
}
