#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const tool = process.argv[2];
const targetVersionArg = process.argv[3];

if (tool !== "kibana" && tool !== "superset") {
  console.error("Usage: node ./bin/boot-plugin.mjs <kibana|superset> <targetVersion>");
  process.exit(1);
}

const targetVersion =
  targetVersionArg ??
  (tool === "kibana"
    ? process.env.KIBANA_TARGET_VERSION
    : process.env.SUPERSET_TARGET_VERSION);

if (!targetVersion) {
  console.error(
    `Missing target version for ${tool}. Pass it as the second argument or set ` +
      `${tool === "kibana" ? "KIBANA_TARGET_VERSION" : "SUPERSET_TARGET_VERSION"}.`
  );
  process.exit(1);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(packageRoot, "lib", "esm", "plugins", tool, "index.js");

if (!fs.existsSync(modulePath)) {
  console.error(`Build output not found at ${modulePath}. Run npm run build first.`);
  process.exit(1);
}

const pluginModule = await import(pathToFileURL(modulePath).href);
const PluginCtor =
  tool === "kibana"
    ? pluginModule.KibanaDashboardEmbedPlugin
    : pluginModule.SupersetDashboardEmbedPlugin;

if (typeof PluginCtor !== "function") {
  console.error(`Could not load ${tool} plugin constructor from ${modulePath}.`);
  process.exit(1);
}

const plugin = new PluginCtor(targetVersion);
const targetPath = path.join(packageRoot, "plugins", tool);
const result = await plugin.install({
  targetPath,
  targetVersion,
  overwrite: true,
});

if (tool === "kibana") {
  const pluginDir = result.pluginPath;
  const zipPath = path.join(targetPath, "org_dashboard_embed.zip");
  await runCommand(
    "zip",
    ["-r", zipPath, path.basename(pluginDir)],
    path.dirname(pluginDir)
  );
  await runCommand(
    "docker",
    ["compose", "-p", "decaf-e2e", "-f", path.join(targetPath, "docker-compose.yml"), "build", "kibana"],
    targetPath
  );
  await runCommand(
    "docker",
    ["compose", "-p", "decaf-e2e", "-f", path.join(targetPath, "docker-compose.yml"), "up", "-d"],
    targetPath
  );
  await waitForUrl("http://localhost:5602/api/status");
}

if (tool === "superset") {
  await runCommand(
    "docker",
    ["compose", "-p", "decaf-e2e", "-f", path.join(targetPath, "docker-compose.yml"), "build", "superset"],
    targetPath
  );
  await runCommand(
    "docker",
    ["compose", "-p", "decaf-e2e", "-f", path.join(targetPath, "docker-compose.yml"), "up", "-d"],
    targetPath
  );
  await waitForUrl("http://localhost:8089/health");
}

console.log(
  [
    `Booted ${tool} plugin`,
    `targetVersion=${result.descriptor.targetVersion}`,
    `pluginPath=${result.pluginPath}`,
    `files=${result.files.length}`,
  ].join("\n")
);

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 1200000 }, (error, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
      if (error) {
        reject(new Error(output || error.message));
        return;
      }
      resolve(output);
    });
  });
}

async function waitForUrl(url) {
  const timeoutMs = 600000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || (res.status >= 300 && res.status < 500)) {
        return;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Service ${url} did not become ready within ${timeoutMs}ms`);
}
