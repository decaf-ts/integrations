#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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

console.log(
  [
    `Booted ${tool} plugin`,
    `targetVersion=${result.descriptor.targetVersion}`,
    `pluginPath=${result.pluginPath}`,
    `files=${result.files.length}`,
  ].join("\n")
);
