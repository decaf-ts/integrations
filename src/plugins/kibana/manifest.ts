/**
 * @module integrations/plugins/kibana/manifest
 * @summary Kibana embed plugin manifest builder.
 * @description Builds the `kibana.json` manifest for the org-agnostic
 * `orgDashboardEmbed` plugin against a target Kibana version.
 */
import { EMBED_MESSAGE_TYPE } from "../contract";

export const KIBANA_PLUGIN_ID = "orgDashboardEmbed";
export const KIBANA_APP_ID = "org_dashboard_embed";
export const KIBANA_PLUGIN_VERSION = "1.0.0";

export interface KibanaManifest {
  id: string;
  version: string;
  kibanaVersion: string;
  server: boolean;
  ui: boolean;
  requiredPlugins: string[];
  optionalPlugins: string[];
  requiredBundles?: string[];
}

/**
 * Build the `kibana.json` manifest for a target Kibana version.
 *
 * @param targetVersion - Kibana version (defaults to "kibana").
 */
export function buildKibanaManifest(
  targetVersion: string = "kibana"
): KibanaManifest {
  return {
    id: KIBANA_PLUGIN_ID,
    version: KIBANA_PLUGIN_VERSION,
    kibanaVersion: targetVersion,
    server: true,
    ui: true,
    requiredPlugins: ["dashboard", "embeddable", "data"],
    optionalPlugins: [],
  };
}

/**
 * Message type constants re-exported so the generated plugin templates can
 * reference the same protocol identifiers as the host helpers.
 */
export { EMBED_MESSAGE_TYPE };
