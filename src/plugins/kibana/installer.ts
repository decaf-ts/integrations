/**
 * @module integrations/plugins/kibana/installer
 * @summary Kibana dashboard embed plugin installer.
 * @description Implements `DashboardEmbedPlugin` for Kibana: builds the stable
 * iframe embed URL, creates/sends switch-dashboard messages, and materializes
 * the generated plugin source into a target directory (optionally building it).
 *
 * The plugin is org-agnostic: there is never space switching. The current
 * Kibana space comes from the request/session/proxy context, not from the
 * plugin, so the same plugin serves every org.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { UnsupportedError, MaybeContextualArg } from "@decaf-ts/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";

import {
  createSwitchDashboardMessage,
  sendSwitchDashboardMessage,
  type DashboardEmbedPlugin,
  type DashboardEmbedPluginDescriptor,
  type EmbedUrlOptions,
  type PluginInstallOptions,
  type PluginInstallResult,
  type SwitchDashboardPayload,
  type SwitchDashboardMessage,
  type EmbedMessageTarget,
} from "../contract";
import {
  KIBANA_APP_ID,
  KIBANA_PLUGIN_ID,
  KIBANA_PLUGIN_VERSION,
  buildKibanaManifest,
} from "./manifest";
import { kibanaPluginFiles } from "./templates";

/** Default Kibana base path when none is provided. */
export const KIBANA_DEFAULT_BASE_PATH = "kibana";

/**
 * Build the stable Kibana embed iframe URL.
 *
 * @example
 *   buildKibanaEmbedUrl({ host: "ptp.host", dashboardId: "abc", parentOrigin: "https://app.example.com" })
 *   // => "//ptp.host/kibana/app/org_dashboard_embed?dashboardId=abc&parentOrigin=https%3A%2F%2Fapp.example.com"
 */
export function buildKibanaEmbedUrl(options: EmbedUrlOptions): string {
  const basePath = options.basePath ?? KIBANA_DEFAULT_BASE_PATH;
  const params = new URLSearchParams();
  params.set("dashboardId", options.dashboardId);
  params.set("parentOrigin", options.parentOrigin);
  if (options.view?.timeRange) {
    params.set(
      "timeRange",
      JSON.stringify(options.view.timeRange)
    );
  }
  return `//${options.host}/${basePath}/app/${KIBANA_APP_ID}?${params.toString()}`;
}

/**
 * @class KibanaDashboardEmbedPlugin
 * @summary Kibana implementation of the `DashboardEmbedPlugin` contract.
 * @description Org-agnostic multi-tenant dashboard embed plugin for Kibana.
 */
export class KibanaDashboardEmbedPlugin implements DashboardEmbedPlugin {
  public readonly descriptor: DashboardEmbedPluginDescriptor;

  public constructor(targetVersion: string = "kibana") {
    this.descriptor = {
      id: KIBANA_PLUGIN_ID,
      appId: KIBANA_APP_ID,
      version: KIBANA_PLUGIN_VERSION,
      targetVersion,
      tool: "kibana",
    };
  }

  public manifest(targetVersion: string = this.descriptor.targetVersion): Record<string, unknown> {
    return buildKibanaManifest(targetVersion) as unknown as Record<string, unknown>;
  }

  public buildEmbedUrl(options: EmbedUrlOptions): string {
    return buildKibanaEmbedUrl(options);
  }

  public createSwitchDashboardMessage(
    payload: SwitchDashboardPayload
  ): SwitchDashboardMessage {
    return createSwitchDashboardMessage(payload);
  }

  public sendSwitchDashboardMessage(
    target: EmbedMessageTarget,
    payload: SwitchDashboardPayload,
    targetOrigin: string
  ): void {
    sendSwitchDashboardMessage(target, payload, targetOrigin);
  }

  /**
   * Materialize the generated Kibana plugin into `targetPath/org_dashboard_embed/`.
   *
   * Kibana plugins must be built within the Kibana repo against the exact
   * Kibana version. When `build` is true, this attempts `yarn build` in the
   * plugin directory (best-effort); real builds require the Kibana plugin
   * helpers environment.
   */
  public async install(
    options: PluginInstallOptions
  ): Promise<PluginInstallResult> {
    const ctx = options.context as MaybeContextualArg<any> | undefined;
    if (ctx) {
      // Context is accepted for traceability; no logging side-effect required here.
      void ctx;
    }
    if (!options.targetPath || options.targetPath.trim().length === 0) {
      throw new UnsupportedError("install targetPath is required");
    }

    const targetVersion = options.targetVersion ?? this.descriptor.targetVersion;
    const pluginDir = path.resolve(
      options.targetPath,
      KIBANA_APP_ID
    );

    if (fs.existsSync(pluginDir)) {
      if (!options.overwrite) {
        throw new InternalError(
          `Plugin directory already exists: ${pluginDir} (use overwrite: true)`
        );
      }
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }

    const files = kibanaPluginFiles(targetVersion);
    const written: string[] = [];
    for (const file of files) {
      const fullPath = path.join(pluginDir, file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, "utf8");
      written.push(file.path);
    }

    let built = false;
    let buildOutput: string | undefined;
    if (options.build) {
      const result = await this.runBuild(pluginDir).catch((err: Error) => ({
        ok: false as const,
        output: err.message,
      }));
      built = result.ok;
      buildOutput = result.output;
    }

    return {
      pluginPath: pluginDir,
      descriptor: { ...this.descriptor, targetVersion },
      files: written,
      built,
      buildOutput,
    };
  }

  /**
   * Best-effort `yarn build` in the plugin directory. Real builds require the
   * Kibana plugin helpers environment; failures are captured, not thrown.
   */
  protected runBuild(
    pluginDir: string
  ): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
      execFile(
        "yarn",
        ["build"],
        { cwd: pluginDir, timeout: 120000 },
        (error, stdout, stderr) => {
          const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
          if (error) {
            resolve({ ok: false, output: output || error.message });
            return;
          }
          resolve({ ok: true, output });
        }
      );
    });
  }
}

/** Default singleton instance. */
export const kibanaDashboardEmbedPlugin = new KibanaDashboardEmbedPlugin();

/** Factory accepting a target Kibana version. */
export function createKibanaDashboardEmbedPlugin(
  targetVersion: string
): KibanaDashboardEmbedPlugin {
  return new KibanaDashboardEmbedPlugin(targetVersion);
}
