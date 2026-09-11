import { ICalendarWriter } from "./ICalendarWriter";
import { CalendarFile } from "../types";
import { Context } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { injectable } from "@decaf-ts/injectable-decorators";
import { writeFile } from "node:fs/promises";
import { statfsSync } from "node:fs";
import { join } from "path";

@injectable("calendar-writer")
export class FsCalenderWriter implements ICalendarWriter {
  async write(file: CalendarFile, ctx: Context<any>): Promise<CalendarFile> {
    if (typeof process === "undefined" || !process.versions?.node) {
      throw new InternalError("FsCalendarWriter is only available in Node");
    }

    let p = process.env.CALENDAR_PATH || "";

    if (!p) throw new InternalError(`No calendar storage path defined`);
    p = join(p, file.filename);
    if (!statfsSync(p))
      ctx.logger.for(this.write).info(`Writing calendar file to ${p}`);
    await writeFile(p, file.bytes);

    return file;
  }
}
