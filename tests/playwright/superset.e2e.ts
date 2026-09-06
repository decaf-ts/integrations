/**
 * @file Superset dashboard embed plugin — full e2e Playwright test.
 * @description End-to-end test that:
 *   1. Uses the SupersetDashboardEmbedPlugin installer to materialize patch/build scripts
 *      into integrations/plugins/superset/.
 *   2. Builds a custom Superset Docker image from source with the patches applied
 *      (clone → patch → build SDK + frontend → runtime image).
 *   3. Starts Superset + Postgres + Redis via Docker Compose.
 *   4. Creates two dummy dashboards + embedded configurations via the Superset REST API.
 *   5. Serves a host HTML page that loads the patched SDK and embeds the dashboard.
 *   6. Uses Playwright to:
 *      - Navigate to the host page
 *      - Wait for the SDK to mount and report ready
 *      - Take a screenshot (initial dashboard A)
 *      - Click "Dashboard B" to call embeddedDashboard.switchDashboard()
 *      - Wait for the switch result
 *      - Take a screenshot (dashboard B)
 *      - Verify the iframe element is the same reference (no iframe recreation)
 *   7. Tears down Docker and stops the host server.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { SupersetDashboardEmbedPlugin } from "../../../src/plugins/superset";
import {
  compose,
  createStaticServer,
  ensureScreenshots,
  run,
  sleep,
  waitForService,
  SUPERSET_DIR,
} from "./helpers";

const SUPERSET_PORT = 8089;
const SUPERSET_HOST = `http://localhost:${SUPERSET_PORT}`;
const HOST_PORT = 3002;

let hostServer: ReturnType<typeof createStaticServer> | null = null;
let dashboards: {
  dashboardA: string;
  dashboardB: string;
  embeddedA: string;
  embeddedB: string;
} | null = null;

/**
 * Phase 1: Materialize the patch/build scripts into integrations/plugins/superset/.
 */
async function materializePluginScripts() {
  const plugin = new SupersetDashboardEmbedPlugin("6.1.0");
  await plugin.install({ targetPath: SUPERSET_DIR, overwrite: true });
}

/**
 * Phase 2: Build and start Docker (Superset + Postgres + Redis).
 */
async function startDocker() {
  await compose.build(SUPERSET_DIR, "docker-compose.yml", "superset");
  await compose.up(SUPERSET_DIR, "docker-compose.yml");
  await waitForService({ url: `${SUPERSET_HOST}/health`, timeoutMs: 600_000 });
}

/**
 * Phase 3: Create dummy dashboards via the Superset API.
 */
async function createDashboards() {
  const script = path.join(SUPERSET_DIR, "setup-dashboards.sh");
  run(`bash "${script}" "${SUPERSET_HOST}"`);
  const data = JSON.parse(
    fs.readFileSync(path.join(SUPERSET_DIR, "dashboards.json"), "utf8")
  );
  dashboards = {
    dashboardA: String(data.dashboardA),
    dashboardB: String(data.dashboardB),
    embeddedA: data.embeddedA,
    embeddedB: data.embeddedB,
  };
}

/**
 * Phase 4: Start the host HTTP server with the dashboard IDs injected.
 */
function startHostServer() {
  const hostDir = path.join(SUPERSET_DIR, "host");

  // Create a config file that the host page reads
  const configJs = `window.__E2E_CONFIG = {
    supersetHost: "${SUPERSET_HOST}",
    dashboardA: "${dashboards!.dashboardA}",
    dashboardB: "${dashboards!.dashboardB}",
    embeddedA: "${dashboards!.embeddedA}",
    embeddedB: "${dashboards!.embeddedB}",
  };`;
  fs.writeFileSync(path.join(hostDir, "config.js"), configJs);

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
  await compose.down(SUPERSET_DIR, "docker-compose.yml");
  // Clean up generated plugin scripts
  const pluginDir = path.join(SUPERSET_DIR, "org_dashboard_embed_superset");
  if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
  // Clean up generated config.js and dashboards.json
  const configPath = path.join(SUPERSET_DIR, "host", "config.js");
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  const dashboardsPath = path.join(SUPERSET_DIR, "dashboards.json");
  if (fs.existsSync(dashboardsPath)) fs.unlinkSync(dashboardsPath);
}

// ─── Test Suite ──────────────────────────────────────────────────────────

test.describe("Superset dashboard embed plugin — full e2e", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    ensureScreenshots();
    await materializePluginScripts();
    await startDocker();
    await createDashboards();
    startHostServer();
    await sleep(1000);
  });

  test.afterAll(async () => {
    await teardown();
  });

  test("host page loads and mount point is present", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    await expect(page.locator("#supersetMount")).toBeVisible();
  });

  test("embedded SDK mounts and reports ready", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    // Wait for the SDK to mount (set on window.__E2E_READY)
    await page.waitForFunction(() => (window as any).__E2E_READY === true, { timeout: 180_000 });
    expect(await page.evaluate(() => (window as any).__E2E_READY)).toBe(true);
  });

  test("initial dashboard A renders in iframe", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    await page.waitForFunction(() => (window as any).__E2E_READY === true, { timeout: 180_000 });

    // Wait for the iframe to appear inside the mount point
    await page.waitForSelector("#supersetMount iframe", { timeout: 60_000 });

    // Take screenshot
    await page.screenshot({
      path: path.join(ensureScreenshots(), "superset-01-dashboard-a.png"),
      fullPage: true,
    });

    // Verify iframe exists
    const hasIframe = await page.evaluate(() => {
      return !!document.querySelector("#supersetMount iframe");
    });
    expect(hasIframe).toBe(true);
  });

  test("switch to dashboard B via embeddedDashboard.switchDashboard()", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    await page.waitForFunction(() => (window as any).__E2E_READY === true, { timeout: 180_000 });

    // Capture the original iframe element reference
    await page.evaluate(() => {
      (window as any).__ORIGINAL_IFRAME = document.querySelector("#supersetMount iframe");
    });

    // Click "Dashboard B" button to switch
    await page.click("#btn-b");

    // Wait for the switch result
    await page.waitForFunction(
      () => {
        const result = (window as any).__E2E_SWITCH_RESULT;
        return result !== null && result !== undefined;
      },
      { timeout: 180_000 }
    );

    const switchResult = await page.evaluate(() => (window as any).__E2E_SWITCH_RESULT);
    expect(switchResult).toBeTruthy();
    expect(switchResult.accepted).toBe(true);

    // Take screenshot
    await page.screenshot({
      path: path.join(ensureScreenshots(), "superset-02-dashboard-b.png"),
      fullPage: true,
    });
  });

  test("iframe element is preserved across dashboard switches", async ({ page }: { page: Page }) => {
    await page.goto(`http://localhost:${HOST_PORT}`);
    await page.waitForFunction(() => (window as any).__E2E_READY === true, { timeout: 180_000 });

    // Store original iframe reference
    await page.evaluate(() => {
      (window as any).__ORIGINAL_IFRAME = document.querySelector("#supersetMount iframe");
    });

    // Switch to dashboard B
    await page.click("#btn-b");
    await page.waitForFunction(
      () => {
        const result = (window as any).__E2E_SWITCH_RESULT;
        return result !== null && result !== undefined;
      },
      { timeout: 180_000 }
    );

    // Verify iframe is still the same reference
    const sameIframe = await page.evaluate(() => {
      const currentIframe = document.querySelector("#supersetMount iframe");
      return (window as any).__ORIGINAL_IFRAME === currentIframe;
    });
    expect(sameIframe).toBe(true);

    // Switch back to dashboard A
    await page.click("#btn-a");
    await page.waitForFunction(
      () => {
        const result = (window as any).__E2E_SWITCH_RESULT;
        return result !== null && result !== undefined;
      },
      { timeout: 180_000 }
    );

    // Verify iframe is still the same reference
    const stillSameIframe = await page.evaluate(() => {
      const currentIframe = document.querySelector("#supersetMount iframe");
      return (window as any).__ORIGINAL_IFRAME === currentIframe;
    });
    expect(stillSameIframe).toBe(true);

    // Take final screenshot
    await page.screenshot({
      path: path.join(ensureScreenshots(), "superset-03-back-to-a.png"),
      fullPage: true,
    });
  });
});
