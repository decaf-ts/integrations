/**
 * @module integrations/plugins/kibana
 * @summary Kibana dashboard embed plugin surface.
 * @description Org-agnostic multi-tenant Kibana dashboard embed plugin,
 * installer, and host helpers. There is never space switching; the current
 * Kibana space comes from the request/session/proxy context.
 */
export * from "../contract";
export * from "./types";
export * from "./manifest";
export * from "./templates";
export {
  KibanaDashboardEmbedPlugin,
  kibanaDashboardEmbedPlugin,
  createKibanaDashboardEmbedPlugin,
  buildKibanaEmbedUrl,
  KIBANA_DEFAULT_BASE_PATH,
} from "./installer";
export {
  sendKibanaSwitchDashboardMessage,
} from "./host";
