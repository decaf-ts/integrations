/**
 * @module integrations/plugins/superset/host
 * @summary Angular host-side helpers for the Superset embed plugin.
 * @description DOM-free convenience helpers the Angular host uses to build the
 * embedded URL and send switch-dashboard messages to the embedded Superset
 * plugin via the SDK handle.
 */
import {
  sendSwitchDashboardMessage as sendShared,
  type EmbedMessageTarget,
  type EmbedUrlOptions,
  type SwitchDashboardPayload,
} from "../contract";
import { buildSupersetEmbedUrl } from "./installer";

export { buildSupersetEmbedUrl };

/**
 * Send a switch-dashboard message to the embedded Superset dashboard.
 *
 * The Angular host passes the embedded SDK's `EmbeddedDashboard` handle
 * (wrapped to satisfy `EmbedMessageTarget.switchDashboard`) and the Superset
 * origin as `targetOrigin`.
 */
export function sendSupersetSwitchDashboardMessage(
  target: EmbedMessageTarget,
  payload: SwitchDashboardPayload,
  targetOrigin: string
): void {
  sendShared(target, payload, targetOrigin);
}

/** Re-export the URL options type for host convenience. */
export type { EmbedUrlOptions };
