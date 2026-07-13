/**
 * @module integrations/plugins/superset/manifest
 * @summary Superset embed plugin manifest builder (stub).
 * @description Superset has no Kibana-style native plugin system. This builder
 * returns a placeholder manifest describing the embed strategy. Detailed
 * Superset support is deferred ("to be ignored for now").
 */
import { EMBED_MESSAGE_TYPE } from "../contract";

export const SUPERSET_PLUGIN_ID = "orgDashboardEmbedSuperset";
export const SUPERSET_APP_ID = "org_dashboard_embed_superset";
export const SUPERSET_PLUGIN_VERSION = "1.0.0";

export interface SupersetManifest {
  id: string;
  version: string;
  targetVersion: string;
  tool: "superset";
  server: boolean;
  ui: boolean;
  embedStrategy: "iframe";
  status: "stub";
  requiredPlugins: string[];
  optionalPlugins: string[];
}

/**
 * Build the placeholder Superset manifest for a target Superset version.
 */
export function buildSupersetManifest(
  targetVersion: string = "superset"
): SupersetManifest {
  return {
    id: SUPERSET_PLUGIN_ID,
    version: SUPERSET_PLUGIN_VERSION,
    targetVersion,
    tool: "superset",
    server: true,
    ui: true,
    embedStrategy: "iframe",
    status: "stub",
    requiredPlugins: [],
    optionalPlugins: [],
  };
}

export { EMBED_MESSAGE_TYPE };
