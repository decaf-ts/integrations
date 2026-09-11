import { CalendarFile } from "../types";
import { Context } from "@decaf-ts/core";

export interface ICalendarWriter {
  write(file: CalendarFile, ctx: Context<any>): Promise<CalendarFile>;
}
