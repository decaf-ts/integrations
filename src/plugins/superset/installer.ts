/**
 * @module integrations/plugins/superset/installer
 * @summary Superset dashboard embed plugin installer.
 * @description Implements `DashboardEmbedPlugin` for Superset using a
 * patch-and-build strategy. Decaf holds patch scripts that modify Superset's
 * internal embedded frontend and SDK source files to add a `switchDashboard`
 * method. `install` materializes the scripts, clones/uses Superset source,
 * applies patches, and builds (SDK + frontend + optionally Docker image).
 *
 * The same `DashboardEmbedPlugin` API as Kibana is exposed. `sendSwitchDashboardMessage`
 * delegates to `target.switchDashboard(dashboardId, guestToken)` (the Superset
 * SDK handle) instead of `postMessage`.
 */
import { InternalError } from "@decaf-ts/db-decorators";
import { UnsupportedError, MaybeContextualArg } from "@decaf-ts/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";

import {
  createSwitchDashboardMessage,
  sendSwitchDashboardMessage as sendShared,
  type DashboardEmbedPlugin,
  type DashboardEmbedPluginDescriptor,
  type EmbedMessageTarget,
  type EmbedUrlOptions,
  type PluginInstallOptions,
  type PluginInstallResult,
  type SwitchDashboardPayload,
  type SwitchDashboardMessage,
} from "../contract";
import {
  SUPERSET_APP_ID,
  SUPERSET_PLUGIN_ID,
  SUPERSET_PLUGIN_VERSION,
  buildSupersetManifest,
} from "./manifest";
import { supersetPatchFiles } from "./templates";

/** Default Superset base path when none is provided. */
export const SUPERSET_DEFAULT_BASE_PATH = "superset";

/**
 * Extension of `PluginInstallOptions` for Superset-specific build configuration.
 */
export interface SupersetInstallOptions extends PluginInstallOptions {
  /** Path to an existing Superset source checkout. If absent, the installer clones via git. */
  supersetSourcePath?: string;
  /** Git URL to clone Superset from (used when `supersetSourcePath` is absent). */
  supersetGitUrl?: string;
  /** Git ref/branch/tag to checkout after cloning. */
  supersetGitRef?: string;
  /** Docker image tag to build (when provided, builds a Docker image instead of just SDK+frontend). */
  dockerImageTag?: string;
}

/**
 * Build the Superset embedded URL.
 *
 * For Superset, the `dashboardId` field in `EmbedUrlOptions` is the
 * embedded-configuration UUID used in `/embedded/:uuid`.
 *
 * @example
 *   buildSupersetEmbedUrl({ host: "superset.example.com", dashboardId: "abc-uuid", parentOrigin: "https://app.example.com" })
 *   // => "//superset.example.com/superset/embedded/abc-uuid?parentOrigin=https%3A%2F%2Fapp.example.com"
 */
export function buildSupersetEmbedUrl(options: EmbedUrlOptions): string {
  const basePath = options.basePath ?? SUPERSET_DEFAULT_BASE_PATH;
  const params = new URLSearchParams();
  params.set("parentOrigin", options.parentOrigin);
  if (options.view?.timeRange) {
    params.set("timeRange", JSON.stringify(options.view.timeRange));
  }
  return `//${options.host}/${basePath}/embedded/${options.dashboardId}?${params.toString()}`;
}

/**
 * @class SupersetDashboardEmbedPlugin
 * @summary Superset implementation of the `DashboardEmbedPlugin` contract.
 * @description Org-agnostic multi-tenant dashboard embed plugin for Superset
 * using a patch-and-build strategy. Same API as `KibanaDashboardEmbedPlugin`.
 */
export class SupersetDashboardEmbedPlugin implements DashboardEmbedPlugin {
  public readonly descriptor: DashboardEmbedPluginDescriptor;

  public constructor(targetVersion: string = "superset") {
    this.descriptor = {
      id: SUPERSET_PLUGIN_ID,
      appId: SUPERSET_APP_ID,
      version: SUPERSET_PLUGIN_VERSION,
      targetVersion,
      tool: "superset",
    };
  }

  public manifest(targetVersion: string = this.descriptor.targetVersion): Record<string, unknown> {
    return buildSupersetManifest(targetVersion) as unknown as Record<string, unknown>;
  }

  public buildEmbedUrl(options: EmbedUrlOptions): string {
    return buildSupersetEmbedUrl(options);
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
    sendShared(target, payload, targetOrigin);
  }

  /**
   * Materialize the patch and build scripts into `targetPath/`, and when
   * `build` is true, clone/use Superset source, apply patches, and build
   * (SDK + frontend + optionally Docker image).
   *
   * Unlike Kibana (which generates plugin source), Superset's "plugin" is a
   * patch-and-build strategy: Decaf holds scripts that modify Superset's
   * existing internal source files.
   */
  public async install(
    options: SupersetInstallOptions
  ): Promise<PluginInstallResult> {
    const ctx = options.context as MaybeContextualArg<any> | undefined;
    if (ctx) {
      void ctx;
    }
    if (!options.targetPath || options.targetPath.trim().length === 0) {
      throw new UnsupportedError("install targetPath is required");
    }

    const targetVersion = options.targetVersion ?? this.descriptor.targetVersion;
    const pluginDir = path.resolve(
      options.targetPath,
      SUPERSET_APP_ID
    );

    if (fs.existsSync(pluginDir)) {
      if (!options.overwrite) {
        throw new InternalError(
          `Plugin directory already exists: ${pluginDir} (use overwrite: true)`
        );
      }
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }

    const files = supersetPatchFiles();
    const written: string[] = [];
    for (const file of files) {
      const fullPath = path.join(pluginDir, file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, "utf8");
      if (file.executable) {
        fs.chmodSync(fullPath, 0o755);
      }
      written.push(file.path);
    }

    let built = false;
    let buildOutput: string | undefined;

    if (options.build) {
      const supersetRoot = await this.resolveSupersetRoot(pluginDir, options);
      const result = await this.runPatchAndBuild(
        pluginDir,
        supersetRoot,
        options
      ).catch((err: Error) => ({
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
   * Resolve the Superset source root: use an existing checkout or clone via git.
   */
  protected async resolveSupersetRoot(
    pluginDir: string,
    options: SupersetInstallOptions
  ): Promise<string> {
    if (options.supersetSourcePath) {
      const resolved = path.resolve(options.supersetSourcePath);
      if (!fs.existsSync(path.join(resolved, "superset-frontend", "src", "embedded", "index.tsx"))) {
        throw new InternalError(
          `Superset source not found at: ${resolved} (missing superset-frontend/src/embedded/index.tsx)`
        );
      }
      return resolved;
    }

    const gitUrl = options.supersetGitUrl ?? "https://github.com/apache/superset.git";
    const gitRef = options.supersetGitRef ?? options.targetVersion ?? "6.1.0";
    const cloneDir = path.join(pluginDir, ".superset-source");

    if (fs.existsSync(cloneDir)) {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    await this.runCommand("git", ["clone", "--depth", "1", "--branch", gitRef, gitUrl, cloneDir], pluginDir);
    return cloneDir;
  }

  /**
   * Apply patches, verify, and build (SDK + frontend + optionally Docker).
   */
  protected async runPatchAndBuild(
    pluginDir: string,
    supersetRoot: string,
    options: SupersetInstallOptions
  ): Promise<{ ok: boolean; output: string }> {
    const outputs: string[] = [];

    // 1. Apply patch
    const patchResult = await this.runCommand(
      "python3",
      [path.join(pluginDir, "patches", "apply_superset_6_1_patch.py"), supersetRoot],
      pluginDir
    );
    outputs.push(patchResult);

    // 2. Verify patch
    const verifyResult = await this.runCommand(
      path.join(pluginDir, "patches", "verify_patch.sh"),
      [supersetRoot],
      pluginDir
    );
    outputs.push(verifyResult);

    // 3. Build (Docker image or SDK + frontend)
    if (options.dockerImageTag) {
      const dockerResult = await this.runCommand(
        path.join(pluginDir, "build", "build-docker-image.sh"),
        [supersetRoot, options.dockerImageTag],
        pluginDir
      );
      outputs.push(dockerResult);
    } else {
      const sdkResult = await this.runCommand(
        path.join(pluginDir, "build", "build-sdk.sh"),
        [supersetRoot],
        pluginDir
      );
      outputs.push(sdkResult);

      const frontendResult = await this.runCommand(
        path.join(pluginDir, "build", "build-superset-frontend.sh"),
        [supersetRoot],
        pluginDir
      );
      outputs.push(frontendResult);
    }

    return { ok: true, output: outputs.join("\n") };
  }

  /**
   * Run a command and capture stdout+stderr.
   */
  protected runCommand(
    cmd: string,
    args: string[],
    cwd: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        cmd,
        args,
        { cwd, timeout: 600000 },
        (error, stdout, stderr) => {
          const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
          if (error) {
            reject(new Error(output || error.message));
            return;
          }
          resolve(output);
        }
      );
    });
  }
}

/** Default singleton instance. */
export const supersetDashboardEmbedPlugin = new SupersetDashboardEmbedPlugin();

/** Factory accepting a target Superset version. */
export function createSupersetDashboardEmbedPlugin(
  targetVersion: string
): SupersetDashboardEmbedPlugin {
  return new SupersetDashboardEmbedPlugin(targetVersion);
}
