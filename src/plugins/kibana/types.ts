/**
 * @module integrations/plugins/kibana/types
 * @summary Kibana embed plugin types.
 * @description Re-exports the shared contract types and exposes Kibana-specific
 * constants/types for the org-agnostic dashboard embed plugin.
 */
export * from "../contract";
export {
  KIBANA_PLUGIN_ID,
  KIBANA_APP_ID,
  KIBANA_PLUGIN_VERSION,
  buildKibanaManifest,
  type KibanaManifest,
} from "./manifest";
export { kibanaPluginFiles, type KibanaPluginFile } from "./templates";
