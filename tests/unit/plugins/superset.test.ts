import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  SupersetDashboardEmbedPlugin,
  supersetDashboardEmbedPlugin,
  createSupersetDashboardEmbedPlugin,
  buildSupersetEmbedUrl,
  sendSupersetSwitchDashboardMessage,
  SUPERSET_PLUGIN_ID,
  SUPERSET_APP_ID,
  SUPERSET_PLUGIN_VERSION,
  buildSupersetManifest,
  supersetPatchFiles,
  SUPERSET_DEFAULT_BASE_PATH,
  type SupersetInstallOptions,
} from "../../../src/plugins/superset";
import {
  EMBED_MESSAGE_TYPE,
  type DashboardEmbedPlugin,
  type EmbedMessageTarget,
} from "../../../src/plugins/contract";

describe("plugins/superset", () => {
  describe("constants", () => {
    it("exposes correct plugin identifiers", () => {
      expect(SUPERSET_PLUGIN_ID).toBe("orgDashboardEmbedSuperset");
      expect(SUPERSET_APP_ID).toBe("org_dashboard_embed_superset");
      expect(SUPERSET_PLUGIN_VERSION).toBe("1.0.0");
      expect(SUPERSET_DEFAULT_BASE_PATH).toBe("superset");
    });
  });

  describe("buildSupersetManifest", () => {
    it("builds a manifest with default target version", () => {
      const m = buildSupersetManifest();
      expect(m.id).toBe(SUPERSET_PLUGIN_ID);
      expect(m.version).toBe(SUPERSET_PLUGIN_VERSION);
      expect(m.targetVersion).toBe("superset");
      expect(m.tool).toBe("superset");
      expect(m.embedStrategy).toBe("iframe");
      expect(m.status).toBe("stub");
      expect(m.server).toBe(true);
      expect(m.ui).toBe(true);
    });

    it("builds a manifest with a specific target version", () => {
      const m = buildSupersetManifest("6.1.0");
      expect(m.targetVersion).toBe("6.1.0");
    });
  });

  describe("supersetPatchFiles", () => {
    it("generates all expected patch and build scripts", () => {
      const files = supersetPatchFiles();
      const paths = files.map((f) => f.path);
      expect(paths).toContain("patches/apply_superset_6_1_patch.py");
      expect(paths).toContain("patches/verify_patch.sh");
      expect(paths).toContain("build/build-sdk.sh");
      expect(paths).toContain("build/build-superset-frontend.sh");
      expect(paths).toContain("build/patch-and-build.sh");
      expect(paths).toContain("build/build-docker-image.sh");
      expect(paths).toContain("README.md");
    });

    it("includes the patch marker in the Python script", () => {
      const files = supersetPatchFiles();
      const pyFile = files.find((f) => f.path === "patches/apply_superset_6_1_patch.py");
      expect(pyFile).toBeDefined();
      expect(pyFile!.content).toContain("SUPERSET_SWITCHABLE_EMBED_PATCH");
      expect(pyFile!.content).toContain("switchDashboard");
      expect(pyFile!.content).toContain("dashboardSwitchHandler");
    });

    it("includes verification markers in the verify script", () => {
      const files = supersetPatchFiles();
      const shFile = files.find((f) => f.path === "patches/verify_patch.sh");
      expect(shFile).toBeDefined();
      expect(shFile!.content).toContain("SUPERSET_SWITCHABLE_EMBED_PATCH");
      expect(shFile!.content).toContain("SUPERSET_SWITCHABLE_EMBED_SDK_PATCH");
      expect(shFile!.content).toContain("switchDashboard");
      expect(shFile!.content).toContain("activeDashboardId");
    });

    it("includes docker build in the docker script", () => {
      const files = supersetPatchFiles();
      const dockerFile = files.find((f) => f.path === "build/build-docker-image.sh");
      expect(dockerFile).toBeDefined();
      expect(dockerFile!.content).toContain("docker build");
      expect(dockerFile!.content).toContain("--target lean");
    });

    it("marks scripts as executable", () => {
      const files = supersetPatchFiles();
      const pyFile = files.find((f) => f.path === "patches/apply_superset_6_1_patch.py");
      expect(pyFile!.executable).toBe(true);
      const shFile = files.find((f) => f.path === "patches/verify_patch.sh");
      expect(shFile!.executable).toBe(true);
    });
  });

  describe("buildSupersetEmbedUrl", () => {
    it("builds a URL with default base path", () => {
      const url = buildSupersetEmbedUrl({
        host: "superset.host",
        dashboardId: "embed-uuid-123",
        parentOrigin: "https://app.example.com",
      });
      expect(url).toContain("//superset.host/superset/embedded/embed-uuid-123");
      expect(url).toContain("parentOrigin=" + encodeURIComponent("https://app.example.com"));
    });

    it("builds a URL with custom base path", () => {
      const url = buildSupersetEmbedUrl({
        host: "superset.host",
        basePath: "custom-superset",
        dashboardId: "uuid",
        parentOrigin: "https://app.example.com",
      });
      expect(url).toContain("/custom-superset/embedded/uuid");
    });
  });

  describe("SupersetDashboardEmbedPlugin", () => {
    const plugin = new SupersetDashboardEmbedPlugin("6.1.0");

    it("has the correct descriptor", () => {
      expect(plugin.descriptor.id).toBe(SUPERSET_PLUGIN_ID);
      expect(plugin.descriptor.appId).toBe(SUPERSET_APP_ID);
      expect(plugin.descriptor.tool).toBe("superset");
      expect(plugin.descriptor.targetVersion).toBe("6.1.0");
    });

    it("implements the DashboardEmbedPlugin interface", () => {
      expect(typeof plugin.manifest).toBe("function");
      expect(typeof plugin.buildEmbedUrl).toBe("function");
      expect(typeof plugin.createSwitchDashboardMessage).toBe("function");
      expect(typeof plugin.sendSwitchDashboardMessage).toBe("function");
      expect(typeof plugin.install).toBe("function");
    });

    it("manifest() returns the superset manifest object", () => {
      const m = plugin.manifest();
      expect(m.id).toBe(SUPERSET_PLUGIN_ID);
      expect(m.targetVersion).toBe("6.1.0");
      expect(m.tool).toBe("superset");
    });

    it("createSwitchDashboardMessage returns a message with correct type", () => {
      const msg = plugin.createSwitchDashboardMessage({ dashboardId: "d1", guestToken: "tok" });
      expect(msg.type).toBe(EMBED_MESSAGE_TYPE.SWITCH);
      expect(msg.dashboardId).toBe("d1");
      expect(msg.guestToken).toBe("tok");
    });

    it("sendSwitchDashboardMessage uses switchDashboard on the target", async () => {
      const switched: Array<{ id: string; token?: string }> = [];
      const target: EmbedMessageTarget = {
        switchDashboard: async (dashboardId: string, guestToken?: string) => {
          switched.push({ id: dashboardId, token: guestToken });
          return { dashboardId, accepted: true as const };
        },
      };
      plugin.sendSwitchDashboardMessage(target, { dashboardId: "d2", guestToken: "gt" }, "https://host");
      expect(switched).toEqual([{ id: "d2", token: "gt" }]);
    });

    it("sendSupersetSwitchDashboardMessage convenience helper works", async () => {
      const switched: string[] = [];
      const target: EmbedMessageTarget = {
        switchDashboard: async (dashboardId: string) => {
          switched.push(dashboardId);
          return { dashboardId, accepted: true as const };
        },
      };
      sendSupersetSwitchDashboardMessage(target, { dashboardId: "d3" }, "https://host");
      expect(switched).toEqual(["d3"]);
    });
  });

  describe("singleton and factory", () => {
    it("exports a default singleton", () => {
      expect(supersetDashboardEmbedPlugin).toBeInstanceOf(SupersetDashboardEmbedPlugin);
      expect(supersetDashboardEmbedPlugin.descriptor.tool).toBe("superset");
    });

    it("createSupersetDashboardEmbedPlugin returns a new instance with target version", () => {
      const p = createSupersetDashboardEmbedPlugin("6.2.0");
      expect(p).toBeInstanceOf(SupersetDashboardEmbedPlugin);
      expect(p.descriptor.targetVersion).toBe("6.2.0");
    });
  });

  describe("install", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superset-plugin-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes all patch and build scripts to the target directory (no build)", async () => {
      const plugin = new SupersetDashboardEmbedPlugin("6.1.0");
      const result = await plugin.install({ targetPath: tmpDir });

      expect(result.descriptor.targetVersion).toBe("6.1.0");
      expect(result.built).toBe(false);
      expect(result.files).toContain("patches/apply_superset_6_1_patch.py");
      expect(result.files).toContain("patches/verify_patch.sh");
      expect(result.files).toContain("build/build-sdk.sh");
      expect(result.files).toContain("build/build-docker-image.sh");

      const pluginDir = path.join(tmpDir, SUPERSET_APP_ID);
      expect(fs.existsSync(path.join(pluginDir, "patches", "apply_superset_6_1_patch.py"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "build", "patch-and-build.sh"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "README.md"))).toBe(true);
    });

    it("makes scripts executable on POSIX", async () => {
      const plugin = new SupersetDashboardEmbedPlugin("6.1.0");
      await plugin.install({ targetPath: tmpDir });
      const pluginDir = path.join(tmpDir, SUPERSET_APP_ID);
      const shPath = path.join(pluginDir, "patches", "verify_patch.sh");
      const stat = fs.statSync(shPath);
      // Check executable bit (mode & 0o111)
      expect((stat.mode & 0o111)).not.toBe(0);
    });

    it("throws if targetPath is empty", async () => {
      const plugin = new SupersetDashboardEmbedPlugin();
      await expect(plugin.install({ targetPath: "" } as SupersetInstallOptions)).rejects.toThrow();
    });

    it("throws if directory exists without overwrite", async () => {
      const plugin = new SupersetDashboardEmbedPlugin();
      await plugin.install({ targetPath: tmpDir });
      await expect(plugin.install({ targetPath: tmpDir } as SupersetInstallOptions)).rejects.toThrow();
    });

    it("overwrites when overwrite is true", async () => {
      const plugin = new SupersetDashboardEmbedPlugin("6.1.0");
      await plugin.install({ targetPath: tmpDir });
      const result = await plugin.install({ targetPath: tmpDir, overwrite: true } as SupersetInstallOptions);
      expect(result.files).toContain("patches/apply_superset_6_1_patch.py");
    });
  });

  describe("API parity with Kibana", () => {
    it("satisfies the DashboardEmbedPlugin interface", () => {
      const plugin: DashboardEmbedPlugin = new SupersetDashboardEmbedPlugin();
      expect(plugin.descriptor.tool).toBe("superset");
    });

    it("has the same method signatures as KibanaDashboardEmbedPlugin", () => {
      // Both implement DashboardEmbedPlugin, so the API is structurally identical.
      const superset: DashboardEmbedPlugin = new SupersetDashboardEmbedPlugin();
      expect(typeof superset.manifest).toBe("function");
      expect(typeof superset.buildEmbedUrl).toBe("function");
      expect(typeof superset.createSwitchDashboardMessage).toBe("function");
      expect(typeof superset.sendSwitchDashboardMessage).toBe("function");
      expect(typeof superset.install).toBe("function");
    });
  });
});
