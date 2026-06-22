/**
 * @module integrations/utils
 * @summary Shared integration utilities.
 * @description Utility helpers used across the integrations package.
 */
import { exec } from "child_process";
import { Logger, LogLevel } from "@decaf-ts/logging";
import { InternalError } from "@decaf-ts/db-decorators";

export async function execWithLogging(
  command: string,
  options: { cwd: string },
  log: Logger,
  level: LogLevel = LogLevel.info
): Promise<{ stdout: string; stderr: string }> {
  log.debug(`Executing: ${command}`);

  return new Promise((resolve, reject) => {
    const child = exec(command, options);

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on("data", (data: string) => {
      stdout.push(data);
      log[level](data.trim());
    });

    child.stderr?.on("data", (data: string) => {
      stderr.push(data);
      log.error(data.trim());
    });

    child.on("close", (code: number) => {
      if (code === 0) {
        log.silly(`Command completed successfully`);
        resolve({ stdout: stdout.join("\n"), stderr: stderr.join("\n") });
      } else {
        log.critical(
          `Command failed with code ${code}:\n ${stderr.join("\n")}`
        );
        reject(
          new InternalError(
            `Command failed with code ${code}: ${stderr.join("\n")}`
          )
        );
      }
    });

    child.on("error", (err: Error) => {
      log.critical(`Command execution error`, err);
      reject(err);
    });
  });
}
