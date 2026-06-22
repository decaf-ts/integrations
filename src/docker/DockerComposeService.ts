import { description } from "@decaf-ts/decoration";
import {
  ClientBasedService,
  ContextualArgs,
  MaybeContextualArg,
} from "@decaf-ts/core";
import path from "path";
import fs from "fs";
import { execWithLogging } from "../utils";

interface DockerComposeServiceConfig {
  composeFile: string;
  workingDir?: string;
}

interface DockerHealthCheckOptions {
  maxAttempts?: number;
  interval?: number;
}

@description("Docker Compose service for managing containerized environments")
export class DockerComposeService extends ClientBasedService<
  void,
  DockerComposeServiceConfig
> {
  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: DockerComposeServiceConfig; client: void }> {
    const { log, ctxArgs } = await this.logCtx(args, this.initialize, true);
    const config = ctxArgs[0] as DockerComposeServiceConfig;

    if (!config.composeFile) {
      throw new Error("DockerComposeService requires a composeFile path");
    }

    // Validate compose file exists
    if (!fs.existsSync(config.composeFile)) {
      throw new Error(`Docker compose file not found: ${config.composeFile}`);
    }

    log.info(`Initialized with compose file: ${config.composeFile}`);

    this._config = config;

    return { config, client: undefined };
  }

  /**
   * Get the working directory for docker compose commands
   */
  protected get workingDir(): string {
    return this.config.workingDir || path.dirname(this.config.composeFile);
  }

  /**
   * Get the basename of the compose file
   */
  protected get composeFileName(): string {
    return path.basename(this.config.composeFile);
  }

  /**
   * Start Docker Compose services
   */
  async up(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.up, true);
    const detached = ctxArgs[0]?.[0] !== false;
    const command = `docker compose -f ${this.composeFileName} up ${detached ? "-d" : ""}`;

    await execWithLogging(command, { cwd: this.workingDir }, log);
    log.info(`Docker compose services started`);
  }

  /**
   * Stop Docker Compose services
   */
  async down(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.down, true);
    const command = `docker compose -f ${this.composeFileName} down`;

    await execWithLogging(command, { cwd: this.workingDir }, log);
    log.info(`Docker compose services stopped`);
  }

  /**
   * Restart Docker Compose services
   */
  async restart(...args: MaybeContextualArg<any>): Promise<void> {
    const { log, ctxArgs } = await this.logCtx(args, this.restart, true);
    const command = `docker compose -f ${this.composeFileName} restart`;

    await execWithLogging(command, { cwd: this.workingDir }, log);
    log.info(`Docker compose services restarted`);
  }

  /**
   * Wait for service health check
   */
  async waitForHealth(
    url: string,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log, ctxArgs } = await this.logCtx(args, this.waitForHealth, true);
    const options =
      ctxArgs[0]?.[0] && typeof ctxArgs[0][0] === "object"
        ? (ctxArgs[0][0] as DockerHealthCheckOptions)
        : {};
    const { maxAttempts = 60, interval = 2000 } = options;

    log.info(`Waiting for health check at ${url}`);

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          log.info(`Health check passed after ${i + 1} attempts`);
          return true;
        }
      } catch (error) {
        log.silly(`Health check attempt ${i + 1} failed`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    log.error(`Health check failed for ${url} after ${maxAttempts} attempts`);
    throw new Error(
      `Health check failed for ${url} after ${maxAttempts} attempts`
    );
  }

  /**
   * Execute a command in a specific container
   */
  async execInContainer(
    containerName: string,
    command: string,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(
      args,
      this.execInContainer,
      true
    );
    const fullCommand = `docker compose -f ${this.composeFileName} exec ${containerName} ${command}`;

    const { stdout } = await execWithLogging(
      fullCommand,
      { cwd: this.workingDir },
      log
    );

    log.info(`Executed command in container ${containerName}`);
    return stdout;
  }

  /**
   * Get container logs
   */
  async getLogs(
    containerName?: string,
    tail = 100,
    ...args: MaybeContextualArg<any>
  ): Promise<string> {
    const { log, ctxArgs } = await this.logCtx(args, this.getLogs, true);
    const containerArg = containerName ? containerName : "";
    const command = `docker compose -f ${this.composeFileName} logs ${containerArg} --tail=${tail}`;

    const { stdout } = await execWithLogging(
      command,
      { cwd: this.workingDir },
      log
    );

    log.info(`Retrieved logs for ${containerName || "all containers"}`);
    return stdout;
  }

  /**
   * Check if a container is running
   */
  async isRunning(
    containerName: string,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = await this.logCtx(args, this.isRunning, true);

    try {
      const command = `docker compose -f ${this.composeFileName} ps ${containerName} --format "{{.Status}}"`;
      const { stdout } = await execWithLogging(
        command,
        { cwd: this.workingDir },
        log
      );

      const isRunning = stdout.trim().toLowerCase().includes("running");
      log.silly(
        `Container ${containerName} is ${isRunning ? "running" : "not running"}`
      );
      return isRunning;
    } catch {
      log.silly(`Container ${containerName} is not running`);
      return false;
    }
  }
}
