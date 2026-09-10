import { ICalendarWriter } from "./ICalendarWriter";
import { CalendarFile } from "../types";
import { Context } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { injectable } from "@decaf-ts/injectable-decorators";

@injectable("calendar-writer")
export class DownloadCalenderWriter implements ICalendarWriter {
  async write(file: CalendarFile, ctx: Context): Promise<CalendarFile> {
    if (
      typeof (globalThis as any).window === "undefined" ||
      typeof (globalThis as any).document === "undefined"
    ) {
      throw new InternalError(
        "Calendar Download is only available in a browser."
      );
    }
    const log = ctx.logger.for(this.write);

    const blob = new Blob([file.content], {
      type: `${file.mimeType};charset=utf-8`,
    });

    const objectUrl = URL.createObjectURL(blob);

    log.debug(`Downloadable blob at ${objectUrl}`);
    const anchor = (globalThis as any).document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = file.filename;
    anchor.style.display = "none";

    (globalThis as any).document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    (globalThis as any).window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      log.debug(`Downloadable blob at ${objectUrl} expired`);
    }, 1_000);

    return file;
  }
}
