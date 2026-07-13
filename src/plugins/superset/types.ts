/**
 * @module integrations/plugins/superset/types
 * @summary Superset embed plugin types.
 * @description Re-exports the shared contract types and Superset-specific
 * constants/types for the org-agnostic dashboard embed plugin.
 */
export * from "../contract";
export {
  SUPERSET_PLUGIN_ID,
  SUPERSET_APP_ID,
  SUPERSET_PLUGIN_VERSION,
  buildSupersetManifest,
  type SupersetManifest,
} from "./manifest";
export { supersetPatchFiles, type SupersetPatchFile } from "./templates";
export {
  SupersetDashboardEmbedPlugin,
  supersetDashboardEmbedPlugin,
  createSupersetDashboardEmbedPlugin,
  buildSupersetEmbedUrl,
  SUPERSET_DEFAULT_BASE_PATH,
  type SupersetInstallOptions,
} from "./installer";
