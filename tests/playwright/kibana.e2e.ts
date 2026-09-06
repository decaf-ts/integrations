/**
 * @file Kibana dashboard embed plugin — full e2e Playwright test.
 * @description End-to-end test that:
 *   1. Uses the KibanaDashboardEmbedPlugin installer to generate the plugin source.
 *   2. Zips the plugin and builds a custom Kibana Docker image with the plugin installed.
 *   3. Starts Elasticsearch + Kibana via Docker Compose.
 *   4. Creates two dummy dashboards via the Kibana saved objects API.
 *   5. Serves a host HTML page that embeds the Kibana dashboard in an iframe.
 *   6. Uses Playwright to:
 *      - Navigate to the host page
 *      - Wait for the ORG_DASHBOARD_EMBED_READY message
 *      - Wait for the ORG_DASHBOARD_EMBED_RENDERED message
 *      - Take a screenshot (initial dashboard A)
 *      - Click "Dashboard B" to switch dashboards via postMessage
 *      - Wait for the new RENDERED message
 *      - Take a screenshot (dashboard B)
 *      - Verify the iframe element is the same reference (no iframe recreation)
 *   7. Tears down Docker and stops the host server.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { KibanaDashboardEmbedPlugin } from "../../../src/plugins/kibana";
import {
  compose,
  createStaticServer,
  ensureScreenshots,
  run,
  sleep,
  waitForService,
  KIBANA_DIR,
} from "./helpers";

const KIBANA_PORT = 5602;
const KIBANA_HOST = `http://localhost:${KIBANA_PORT}`;
const HOST_PORT = 3001;

let hostServer: ReturnType<typeof createStaticServer> | null = null;
let dashboards: { dashboardA: string; dashboardB: string } | null = null;

/**
 * Phase 1: Generate the plugin source into integrations/plugins/kibana/ and zip it.
 */
async function buildPluginZip(): Promise<string> {
  const plugin = new KibanaDashboardEmbedPlugin("8.14.3");
  const result = await plugin.install({ targetPath: KIBANA_DIR, overwrite: true });
  const pluginDir = result.pluginPath;
  const zipPath = path.join(KIBANA_DIR, "org_dashboard_embed.zip");

  // The zip must contain the plugin directory at the root
  run(`cd "${path.dirname(pluginDir)}" && zip -r "${zipPath}" "${path.basename(pluginDir)}"/`);
  return zipPath;
}

/**
 * Phase 2: Build and start Docker (Elasticsearch + Kibana with plugin).
 */
async function startDocker() {
  await compose.build(KIBANA_DIR, "docker-compose.yml", "kibana");
  await compose.up(KIBANA_DIR, "docker-compose.yml");
  await waitForService({ url: `${KIBANA_HOST}/api/status`, timeoutMs: 300_000 });
}

/**
 * Phase 3: Create dummy dashboards via the Kibana API.
 */
async function createDashboards() {
  const script = path.join(KIBANA_DIR, "setup-dashboards.sh");
  run(`bash "${script}" "${KIBANA_HOST}"`);
  const data = JSON.parse(
    fs.readFileSync(path.join(KIBANA_DIR, "dashboards.json"), "utf8")
  );
  dashboards = { dashboardA: data.dashboardA, dashboardB: data.dashboardB };
}

/**
 * Phase 4: Start the host HTTP server with the dashboard IDs injected.
 */
function startHostServer() {
  const hostDir = path.join(KIBANA_DIR, "host");

  // Create a config file that the host page reads
  const configJs = `window.__E2E_CONFIG = {
    kibanaHost: "${KIBANA_HOST}",
    dashboardA: "${dashboards!.dashboardA}",
    dashboardB: "${dashboards!.dashboardB}",
  };`;
  fs.writeFileSync(path.join(hostDir, "config.js"), configJs);

  // Inject config.js into the HTML (add script tag before the main script)
  const html = fs.readFileSync(path.join(hostDir, "index.html"), "utf8");
  if (!html.includes("config.js")) {
    const modified = html.replace("</head>", '  <script src="config.js"></script>\n</head>');
    fs.writeFileSync(path.join(hostDir, "index.html"), modified);
  }

  hostServer = createStaticServer(hostDir);
  hostServer.listen(HOST_PORT);
}

/**
 * Teardown: stop Docker and host server, clean up generated artifacts.
 */
async function teardown() {
  if (hostServer) {
    hostServer.close();
    hostServer = null;
  }
  await compose.down(KIBANA_DIR, "docker-compose.yml");
  // Clean up the zip and generated plugin source
  const zipPath = path.join(KIBANA_DIR, "org_dashboard_embed.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const pluginDir = path.join(KIBANA_DIR, "org_dashboard_embed");
  if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
  // Clean up generated config.js and dashboards.json
  const configPath = path.join(KIBANA_DIR, "host", "config.js");
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  const dashboardsPath = path.join(KIBANA_DIR, "dashboards.json");
  if (fs.existsSync(dashboardsPath)) fs.unlinkSync(dashboardsPath);
}

// ─── Test Suite ──────────────────────────────────────────────────────────

test.describe("Kibana dashboard embed plugin — full e2e", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    ensureScreenshots();
    await buildPluginZip();
    await startDocker();
    await createDashboards();
    startHostServer();
    // Give the host server a moment to start
    await sleep(1000);
  });

  test.afterAll(async () => {
    await teardown();
  });

  test("host page loads and iframe is present", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    await expect(page.locator("#kibanaFrame")).toBeVisible();
  });

  test("embedded plugin sends READY message", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    // Wait for the READY message (set on window.__E2E_READY)
    await page.waitForFunction(() => (window as any).__E2E_READY === true, { timeout: 120_000 });
    expect(await page.evaluate(() => (window as any).__E2E_READY)).toBe(true);
  });

  test("initial dashboard A renders", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    // Wait for RENDERED message with dashboard A
    await page.waitForFunction(
      () => (window as any).__E2E_RENDERED !== null && (window as any).__E2E_RENDERED !== undefined,
      { timeout: 120_000 }
    );
    const renderedId = await page.evaluate(() => (window as any).__E2E_RENDERED);
    expect(renderedId).toBe(dashboards!.dashboardA);

    // Take screenshot
    await page.screenshot({
      path: path.join(ensureScreenshots(), "kibana-01-dashboard-a.png"),
      fullPage: true,
    });
  });

  test("switch to dashboard B via postMessage", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);

    // Wait for initial render
    await page.waitForFunction(
      () => (window as any).__E2E_RENDERED !== null && (window as any).__E2E_RENDERED !== undefined,
      { timeout: 120_000 }
    );

    // Capture the original iframe element reference
    const originalIframe = await page.evaluate(() => {
      const iframe = document.getElementById("kibanaFrame");
      (window as any).__ORIGINAL_IFRAME = iframe;
      return !!iframe;
    });
    expect(originalIframe).toBe(true);

    // Click "Dashboard B" button to switch
    await page.click("#btn-b");

    // Wait for the new RENDERED message with dashboard B
    await page.waitForFunction(
      (expectedId: string) => (window as any).__E2E_RENDERED === expectedId,
      dashboards!.dashboardB,
      { timeout: 120_000 }
    );

    const renderedId = await page.evaluate(() => (window as any).__E2E_RENDERED);
    expect(renderedId).toBe(dashboards!.dashboardB);

    // Take screenshot
    await page.screenshot({
      path: path.join(ensureScreenshots(), "kibana-02-dashboard-b.png"),
      fullPage: true,
    });
  });

  test("iframe element is preserved across dashboard switches", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);

    // Wait for initial render
    await page.waitForFunction(
      () => (window as any).__E2E_RENDERED !== null && (window as any).__E2E_RENDERED !== undefined,
      { timeout: 120_000 }
    );

    // Store original iframe reference
    await page.evaluate(() => {
      (window as any).__ORIGINAL_IFRAME = document.getElementById("kibanaFrame");
    });

    // Switch to dashboard B
    await page.click("#btn-b");
    await page.waitForFunction(
      (expectedId: string) => (window as any).__E2E_RENDERED === expectedId,
      dashboards!.dashboardB,
      { timeout: 120_000 }
    );

    // Switch back to dashboard A
    await page.click("#btn-a");
    await page.waitForFunction(
      (expectedId: string) => (window as any).__E2E_RENDERED === expectedId,
      dashboards!.dashboardA,
      { timeout: 120_000 }
    );

    // Verify the iframe element is the same reference
    const sameIframe = await page.evaluate(() => {
      const currentIframe = document.getElementById("kibanaFrame");
      return (window as any).__ORIGINAL_IFRAME === currentIframe;
    });
    expect(sameIframe).toBe(true);

    // Take final screenshot
    await page.screenshot({
      path: path.join(ensureScreenshots(), "kibana-03-back-to-a.png"),
      fullPage: true,
    });
  });
});
