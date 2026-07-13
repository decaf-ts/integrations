/**
 * @module integrations/plugins/superset
 * @summary Superset dashboard embed plugin surface.
 * @description Org-agnostic multi-tenant Superset dashboard embed plugin
 * (patch-and-build strategy). Same API as the Kibana plugin. Decaf holds
 * patch scripts that modify Superset's internal embedded frontend and SDK
 * source files to add a `switchDashboard` method, keeping the iframe element,
 * document, contentWindow, React runtime, and Switchboard MessageChannel alive.
 */
export * from "../contract";
export * from "./types";
export * from "./manifest";
export * from "./templates";
export {
  SupersetDashboardEmbedPlugin,
  supersetDashboardEmbedPlugin,
  createSupersetDashboardEmbedPlugin,
  buildSupersetEmbedUrl,
  SUPERSET_DEFAULT_BASE_PATH,
  type SupersetInstallOptions,
} from "./installer";
export {
  sendSupersetSwitchDashboardMessage,
} from "./host";
