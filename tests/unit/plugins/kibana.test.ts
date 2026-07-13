import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  KibanaDashboardEmbedPlugin,
  kibanaDashboardEmbedPlugin,
  createKibanaDashboardEmbedPlugin,
  buildKibanaEmbedUrl,
  sendKibanaSwitchDashboardMessage,
  KIBANA_PLUGIN_ID,
  KIBANA_APP_ID,
  KIBANA_PLUGIN_VERSION,
  buildKibanaManifest,
  kibanaPluginFiles,
  KIBANA_DEFAULT_BASE_PATH,
} from "../../../src/plugins/kibana";
import {
  EMBED_MESSAGE_TYPE,
  type DashboardEmbedPlugin,
  type EmbedMessageTarget,
} from "../../../src/plugins/contract";

describe("plugins/kibana", () => {
  describe("constants", () => {
    it("exposes correct plugin identifiers", () => {
      expect(KIBANA_PLUGIN_ID).toBe("orgDashboardEmbed");
      expect(KIBANA_APP_ID).toBe("org_dashboard_embed");
      expect(KIBANA_PLUGIN_VERSION).toBe("1.0.0");
      expect(KIBANA_DEFAULT_BASE_PATH).toBe("kibana");
    });
  });

  describe("buildKibanaManifest", () => {
    it("builds a manifest with default target version", () => {
      const m = buildKibanaManifest();
      expect(m.id).toBe(KIBANA_PLUGIN_ID);
      expect(m.version).toBe(KIBANA_PLUGIN_VERSION);
      expect(m.kibanaVersion).toBe("kibana");
      expect(m.server).toBe(true);
      expect(m.ui).toBe(true);
      expect(m.requiredPlugins).toEqual(["dashboard", "embeddable", "data"]);
      expect(m.optionalPlugins).toEqual([]);
    });

    it("builds a manifest with a specific target version", () => {
      const m = buildKibanaManifest("8.14.2");
      expect(m.kibanaVersion).toBe("8.14.2");
    });
  });

  describe("kibanaPluginFiles", () => {
    it("generates all expected files", () => {
      const files = kibanaPluginFiles("8.14.2");
      const paths = files.map((f) => f.path);
      expect(paths).toContain("kibana.json");
      expect(paths).toContain("tsconfig.json");
      expect(paths).toContain("README.md");
      expect(paths).toContain("public/types.ts");
      expect(paths).toContain("public/index.ts");
      expect(paths).toContain("public/plugin.tsx");
      expect(paths).toContain("public/application.tsx");
      expect(paths).toContain("server/index.ts");
      expect(paths).toContain("server/plugin.ts");
    });

    it("bakes the target version into kibana.json", () => {
      const files = kibanaPluginFiles("8.14.2");
      const manifestFile = files.find((f) => f.path === "kibana.json");
      expect(manifestFile).toBeDefined();
      const parsed = JSON.parse(manifestFile!.content);
      expect(parsed.kibanaVersion).toBe("8.14.2");
      expect(parsed.id).toBe(KIBANA_PLUGIN_ID);
    });

    it("includes the app id in plugin.tsx", () => {
      const files = kibanaPluginFiles("8.14.2");
      const pluginFile = files.find((f) => f.path === "public/plugin.tsx");
      expect(pluginFile).toBeDefined();
      expect(pluginFile!.content).toContain(KIBANA_APP_ID);
    });

    it("includes the switch message type in application.tsx", () => {
      const files = kibanaPluginFiles("8.14.2");
      const appFile = files.find((f) => f.path === "public/application.tsx");
      expect(appFile).toBeDefined();
      expect(appFile!.content).toContain(EMBED_MESSAGE_TYPE.SWITCH);
      expect(appFile!.content).toContain(EMBED_MESSAGE_TYPE.READY);
      expect(appFile!.content).toContain(EMBED_MESSAGE_TYPE.RENDERED);
      expect(appFile!.content).toContain(EMBED_MESSAGE_TYPE.ERROR);
    });
  });

  describe("buildKibanaEmbedUrl", () => {
    it("builds a URL with default base path", () => {
      const url = buildKibanaEmbedUrl({
        host: "kibana.host",
        dashboardId: "abc",
        parentOrigin: "https://app.example.com",
      });
      expect(url).toContain("//kibana.host/kibana/app/org_dashboard_embed");
      expect(url).toContain("dashboardId=abc");
      expect(url).toContain("parentOrigin=" + encodeURIComponent("https://app.example.com"));
    });

    it("builds a URL with custom base path", () => {
      const url = buildKibanaEmbedUrl({
        host: "kibana.host",
        basePath: "custom-kibana",
        dashboardId: "xyz",
        parentOrigin: "https://app.example.com",
      });
      expect(url).toContain("/custom-kibana/app/org_dashboard_embed");
    });
  });

  describe("KibanaDashboardEmbedPlugin", () => {
    const plugin = new KibanaDashboardEmbedPlugin("8.14.2");

    it("has the correct descriptor", () => {
      expect(plugin.descriptor.id).toBe(KIBANA_PLUGIN_ID);
      expect(plugin.descriptor.appId).toBe(KIBANA_APP_ID);
      expect(plugin.descriptor.tool).toBe("kibana");
      expect(plugin.descriptor.targetVersion).toBe("8.14.2");
    });

    it("implements the DashboardEmbedPlugin interface", () => {
      expect(typeof plugin.manifest).toBe("function");
      expect(typeof plugin.buildEmbedUrl).toBe("function");
      expect(typeof plugin.createSwitchDashboardMessage).toBe("function");
      expect(typeof plugin.sendSwitchDashboardMessage).toBe("function");
      expect(typeof plugin.install).toBe("function");
    });

    it("manifest() returns the kibana.json object", () => {
      const m = plugin.manifest();
      expect(m.id).toBe(KIBANA_PLUGIN_ID);
      expect(m.kibanaVersion).toBe("8.14.2");
    });

    it("createSwitchDashboardMessage returns a message with correct type", () => {
      const msg = plugin.createSwitchDashboardMessage({ dashboardId: "d1" });
      expect(msg.type).toBe(EMBED_MESSAGE_TYPE.SWITCH);
      expect(msg.dashboardId).toBe("d1");
    });

    it("sendSwitchDashboardMessage posts via postMessage", () => {
      const posted: unknown[] = [];
      const target: EmbedMessageTarget = {
        postMessage: (msg: unknown) => posted.push(msg),
      };
      plugin.sendSwitchDashboardMessage(target, { dashboardId: "d2" }, "https://host");
      expect(posted).toHaveLength(1);
    });

    it("sendKibanaSwitchDashboardMessage convenience helper works", () => {
      const posted: unknown[] = [];
      const target: EmbedMessageTarget = {
        postMessage: (msg: unknown) => posted.push(msg),
      };
      sendKibanaSwitchDashboardMessage(target, { dashboardId: "d3" }, "https://host");
      expect(posted).toHaveLength(1);
    });
  });

  describe("singleton and factory", () => {
    it("exports a default singleton", () => {
      expect(kibanaDashboardEmbedPlugin).toBeInstanceOf(KibanaDashboardEmbedPlugin);
      expect(kibanaDashboardEmbedPlugin.descriptor.tool).toBe("kibana");
    });

    it("createKibanaDashboardEmbedPlugin returns a new instance with target version", () => {
      const p = createKibanaDashboardEmbedPlugin("9.0.0");
      expect(p).toBeInstanceOf(KibanaDashboardEmbedPlugin);
      expect(p.descriptor.targetVersion).toBe("9.0.0");
    });
  });

  describe("install", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kibana-plugin-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes all plugin files to the target directory", async () => {
      const plugin = new KibanaDashboardEmbedPlugin("8.14.2");
      const result = await plugin.install({ targetPath: tmpDir });

      expect(result.descriptor.targetVersion).toBe("8.14.2");
      expect(result.built).toBe(false);
      expect(result.files).toContain("kibana.json");
      expect(result.files).toContain("public/application.tsx");
      expect(result.files).toContain("server/plugin.ts");

      const pluginDir = path.join(tmpDir, KIBANA_APP_ID);
      expect(fs.existsSync(path.join(pluginDir, "kibana.json"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "public", "application.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "server", "plugin.ts"))).toBe(true);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(pluginDir, "kibana.json"), "utf8")
      );
      expect(manifest.kibanaVersion).toBe("8.14.2");
    });

    it("throws if targetPath is empty", async () => {
      const plugin = new KibanaDashboardEmbedPlugin();
      await expect(plugin.install({ targetPath: "" })).rejects.toThrow();
    });

    it("throws if directory exists without overwrite", async () => {
      const plugin = new KibanaDashboardEmbedPlugin();
      await plugin.install({ targetPath: tmpDir });
      await expect(plugin.install({ targetPath: tmpDir })).rejects.toThrow();
    });

    it("overwrites when overwrite is true", async () => {
      const plugin = new KibanaDashboardEmbedPlugin("8.14.2");
      await plugin.install({ targetPath: tmpDir });
      const result = await plugin.install({ targetPath: tmpDir, overwrite: true });
      expect(result.files).toContain("kibana.json");
    });
  });

  describe("API parity with DashboardEmbedPlugin interface", () => {
    it("satisfies the DashboardEmbedPlugin interface", () => {
      const plugin: DashboardEmbedPlugin = new KibanaDashboardEmbedPlugin();
      expect(plugin.descriptor.tool).toBe("kibana");
    });
  });
});
