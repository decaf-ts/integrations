import { exec } from "child_process";
import { Logger } from "@decaf-ts/logging";

export async function execWithLogging(
  command: string,
  options: { cwd: string },
  log: Logger
): Promise<{ stdout: string; stderr: string }> {
  log.debug(`Executing: ${command}`);

  return new Promise((resolve, reject) => {
    const child = exec(command, options);

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: string) => {
      stdout += data;
      log.info(data.trim());
    });

    child.stderr?.on("data", (data: string) => {
      stderr += data;
      log.warn(data.trim());
    });

    child.on("close", (code: number) => {
      if (code === 0) {
        log.silly(`Command completed successfully`);
        resolve({ stdout, stderr });
      } else {
        log.error(`Command failed with code ${code}`, stderr as any);
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    child.on("error", (err: Error) => {
      log.error(`Command execution error`, err);
      reject(err);
    });
  });
}
