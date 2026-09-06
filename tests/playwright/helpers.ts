/**
 * @file Shared helpers for BI dashboard embed plugin e2e tests.
 * @description Manages Docker lifecycle (build, up, down), HTTP polling for
 * service readiness, dashboard creation via REST APIs, and screenshot helpers
 * for Playwright visual validation.
 */
import { execSync, exec as execCb } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import http from "node:http";
import { fileURLToPath } from "node:url";

const execAsync = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname);
export const SCREENSHOTS_DIR = path.join(ROOT, "screenshots");

// Docker infrastructure lives in the install output directories (curated files tracked via .gitignore)
export const INTEGRATIONS_ROOT = path.resolve(__dirname, "../../..");
export const KIBANA_DIR = path.join(INTEGRATIONS_ROOT, "plugins", "kibana");
export const SUPERSET_DIR = path.join(INTEGRATIONS_ROOT, "plugins", "superset");

export const COMPOSE_PROJECT = "decaf-e2e";

export interface ServiceEndpoint {
  url: string;
  healthPath?: string;
  timeoutMs?: number;
}

/**
 * Run a shell command synchronously, throwing on failure.
 */
export function run(cmd: string, opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  const result = execSync(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    timeout: 600_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.trim();
}

/**
 * Run a shell command asynchronously, capturing stdout+stderr.
 */
export async function runAsync(cmd: string, opts: { cwd?: string; timeout?: number } = {}): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, {
    cwd: opts.cwd ?? ROOT,
    timeout: opts.timeout ?? 600_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}

/**
 * Docker Compose wrapper.
 */
export const compose = {
  async up(dir: string, file: string, env?: Record<string, string>) {
    const cmd = `docker compose -p ${COMPOSE_PROJECT} -f ${path.join(dir, file)} up -d`;
    await runAsync(cmd, { cwd: dir, ...env && {} });
  },

  async down(dir: string, file: string) {
    const cmd = `docker compose -p ${COMPOSE_PROJECT} -f ${path.join(dir, file)} down -v --remove-orphans`;
    await runAsync(cmd, { cwd: dir });
  },

  async build(dir: string, file: string, service?: string) {
    const svc = service ? ` ${service}` : "";
    const cmd = `docker compose -p ${COMPOSE_PROJECT} -f ${path.join(dir, file)} build${svc}`;
    await runAsync(cmd, { cwd: dir });
  },

  async logs(dir: string, file: string, service: string): Promise<string> {
    const cmd = `docker compose -p ${COMPOSE_PROJECT} -f ${path.join(dir, file)} logs --tail=100 ${service}`;
    return runAsync(cmd, { cwd: dir });
  },

  async exec(dir: string, file: string, service: string, command: string): Promise<string> {
    const cmd = `docker compose -p ${COMPOSE_PROJECT} -f ${path.join(dir, file)} exec -T ${service} ${command}`;
    return runAsync(cmd, { cwd: dir });
  },

  async port(dir: string, file: string, service: string, port: number): Promise<number> {
    const cmd = `docker compose -p ${COMPOSE_PROJECT} -f ${path.join(dir, file)} port ${service} ${port}`;
    const result = await runAsync(cmd, { cwd: dir });
    return parseInt(result.split(":")[1] ?? "0", 10);
  },
};

/**
 * Wait for an HTTP endpoint to respond with a success status.
 */
export async function waitForService(endpoint: ServiceEndpoint): Promise<void> {
  const url = new URL(endpoint.url);
  const healthPath = endpoint.healthPath ?? url.pathname;
  const timeoutMs = endpoint.timeoutMs ?? 120_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url.protocol}//${url.host}${healthPath}`);
      if (res.ok || (res.status >= 300 && res.status < 500)) {
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(2000);
  }
  throw new Error(`Service ${endpoint.url} did not become ready within ${timeoutMs}ms`);
}

/**
 * Simple HTTP server that serves static files from a directory.
 */
export function createStaticServer(root: string): http.Server {
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
  };

  return http.createServer((req, res) => {
    let urlPath = req.url ?? "/";
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
      res.end(data);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure the screenshots directory exists.
 */
export function ensureScreenshots(): string {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  return SCREENSHOTS_DIR;
}
