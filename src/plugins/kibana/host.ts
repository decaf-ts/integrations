/**
 * @module integrations/plugins/kibana/host
 * @summary Angular host-side helpers for the Kibana embed plugin.
 * @description DOM-free convenience helpers the Angular host uses to build the
 * stable iframe URL and send switch-dashboard messages to the embedded plugin.
 */
import {
  sendSwitchDashboardMessage as sendShared,
  type EmbedMessageTarget,
  type EmbedUrlOptions,
  type SwitchDashboardPayload,
} from "../contract";
import { buildKibanaEmbedUrl } from "./installer";

export { buildKibanaEmbedUrl };

/**
 * Send a switch-dashboard message to the embedded Kibana plugin.
 *
 * The Angular host passes `iframe.contentWindow` (which satisfies
 * `EmbedMessageTarget`) and the Kibana origin as `targetOrigin`.
 */
export function sendKibanaSwitchDashboardMessage(
  target: EmbedMessageTarget,
  payload: SwitchDashboardPayload,
  targetOrigin: string
): void {
  sendShared(target, payload, targetOrigin);
}

/** Re-export the URL options type for host convenience. */
export type { EmbedUrlOptions };
