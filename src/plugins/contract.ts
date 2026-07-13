/**
 * @module integrations/plugins/contract
 * @summary Shared, DOM-free contract for BI dashboard embed plugins.
 * @description Defines the message protocol, embed URL options, install
 * options/result, plugin descriptor, and the `DashboardEmbedPlugin` interface
 * that both the Kibana and Superset plugins implement with the exact same API.
 *
 * This contract is intentionally DOM-free (no `window` / `HTMLIFrameElement`)
 * so it builds under the Node `lib: ["es2022"]` tsconfig and is consumable from
 * both Node and the browser. The Angular host supplies a DOM-free
 * `EmbedMessageTarget` (typically `iframe.contentWindow`).
 */
import type { MaybeContextualArg } from "@decaf-ts/core";
import { UnsupportedError } from "@decaf-ts/core";

/**
 * Message type constants shared between the embedded plugin and the host.
 * The plugin is org-agnostic: there is never space switching; the current
 * Kibana space comes from the request/session/proxy context.
 */
export const EMBED_MESSAGE_TYPE = {
  SWITCH: "ORG_DASHBOARD_EMBED_SWITCH_DASHBOARD",
  READY: "ORG_DASHBOARD_EMBED_READY",
  RENDERED: "ORG_DASHBOARD_EMBED_RENDERED",
  ERROR: "ORG_DASHBOARD_EMBED_ERROR",
} as const;

export type EmbedMessageType =
  (typeof EMBED_MESSAGE_TYPE)[keyof typeof EMBED_MESSAGE_TYPE];

export interface DashboardQuery {
  language: "kuery" | "lucene";
  query: string;
}

export interface DashboardTimeRange {
  from: string;
  to: string;
}

/**
 * Payload used to switch dashboards at runtime.
 *
 * `guestToken` is used by Superset (which requires a dashboard-scoped guest
 * token for each switch) and ignored by Kibana (which relies on the session
 * space context). This keeps the payload shape identical across both plugins.
 */
export interface SwitchDashboardPayload {
  dashboardId: string;
  timeRange?: DashboardTimeRange;
  query?: DashboardQuery;
  filters?: unknown[];
  /** Superset-only: dashboard-scoped guest token. Kibana ignores this. */
  guestToken?: string;
}

export interface SwitchDashboardMessage extends SwitchDashboardPayload {
  type: typeof EMBED_MESSAGE_TYPE.SWITCH;
}

export interface EmbedReadyMessage {
  type: typeof EMBED_MESSAGE_TYPE.READY;
  dashboardId: string | null;
}

export interface EmbedRenderedMessage {
  type: typeof EMBED_MESSAGE_TYPE.RENDERED;
  dashboardId: string;
}

export interface EmbedErrorMessage {
  type: typeof EMBED_MESSAGE_TYPE.ERROR;
  dashboardId: string | null;
  message: string;
}

/**
 * Union of messages the embedded plugin posts back to the parent host.
 */
export type EmbedParentMessage =
  | EmbedReadyMessage
  | EmbedRenderedMessage
  | EmbedErrorMessage;

/**
 * DOM-free message target. Both Kibana and Superset use the same interface;
 * each tool uses a different mechanism:
 *
 * - **Kibana:** the Angular host passes `iframe.contentWindow`, which provides
 *   `postMessage`. `switchDashboard` is unused.
 * - **Superset:** the Angular host passes the embedded SDK's
 *   `EmbeddedDashboard` handle (wrapped), which provides `switchDashboard`.
 *   `postMessage` is unused.
 *
 * At least one of the two methods must be present; each plugin checks for the
 * mechanism it needs and throws an `UnsupportedError` if absent.
 */
export interface EmbedMessageTarget {
  /** Kibana mechanism: post a message to the iframe window. */
  postMessage?(message: unknown, targetOrigin: string): void;
  /** Superset mechanism: call the SDK's switchDashboard method. */
  switchDashboard?(
    dashboardId: string,
    guestToken?: string
  ): Promise<unknown>;
}

export interface EmbedViewOptions {
  showTimeFilter?: boolean;
  showQueryInput?: boolean;
  showFilterBar?: boolean;
  hidePanelTitles?: boolean;
  timeRange?: DashboardTimeRange;
}

export interface EmbedUrlOptions {
  /** Host without protocol, e.g. "ptp.host". */
  host: string;
  /** Base path, e.g. "kibana". Defaults to the tool default. */
  basePath?: string;
  /** Initial dashboard id to render. */
  dashboardId: string;
  /** Parent origin allowlist (comma-separated) passed to the plugin. */
  parentOrigin: string;
  /** Optional view overrides. */
  view?: EmbedViewOptions;
}

export type BiTool = "kibana" | "superset";

export interface DashboardEmbedPluginDescriptor {
  /** Plugin id (e.g. "orgDashboardEmbed"). */
  id: string;
  /** Kibana application id (e.g. "org_dashboard_embed"). */
  appId: string;
  /** Plugin version. */
  version: string;
  /** Target BI tool version this plugin is built against. */
  targetVersion: string;
  /** BI tool this plugin targets. */
  tool: BiTool;
}

export interface PluginInstallOptions {
  /** Directory to materialize the plugin into. */
  targetPath: string;
  /** Overrides `descriptor.targetVersion` when provided. */
  targetVersion?: string;
  /** Attempt to build the plugin after writing files (best-effort). */
  build?: boolean;
  /** Overwrite an existing plugin directory. */
  overwrite?: boolean;
  /** Optional context for tracing/logging. */
  context?: MaybeContextualArg<any>;
}

export interface PluginInstallResult {
  /** Absolute path to the materialized plugin directory. */
  pluginPath: string;
  /** Descriptor used for this install. */
  descriptor: DashboardEmbedPluginDescriptor;
  /** Relative file paths written. */
  files: string[];
  /** Whether a build was attempted and reported success. */
  built: boolean;
  /** Captured build output (stdout/stderr) when `build` was requested. */
  buildOutput?: string;
}

/**
 * Contract both BI dashboard embed plugins implement. Both Kibana and
 * Superset plugins expose the exact same API surface.
 */
export interface DashboardEmbedPlugin {
  readonly descriptor: DashboardEmbedPluginDescriptor;
  /** Build the BI-tool manifest (e.g. kibana.json) for a target version. */
  manifest(targetVersion?: string): Record<string, unknown>;
  /** Build the stable iframe embed URL. */
  buildEmbedUrl(options: EmbedUrlOptions): string;
  /** Create a switch-dashboard message object. */
  createSwitchDashboardMessage(
    payload: SwitchDashboardPayload
  ): SwitchDashboardMessage;
  /** Send a switch-dashboard message to the embedded plugin via `postMessage`. */
  sendSwitchDashboardMessage(
    target: EmbedMessageTarget,
    payload: SwitchDashboardPayload,
    targetOrigin: string
  ): void;
  /** Materialize (and optionally build) the plugin into a target directory. */
  install(options: PluginInstallOptions): Promise<PluginInstallResult>;
}

/**
 * Type guard for the switch-dashboard message received by the embedded plugin.
 */
export function isSwitchDashboardMessage(
  data: unknown
): data is SwitchDashboardMessage {
  if (!data || typeof data !== "object") {
    return false;
  }
  const msg = data as Partial<SwitchDashboardMessage>;
  return (
    msg.type === EMBED_MESSAGE_TYPE.SWITCH &&
    typeof msg.dashboardId === "string" &&
    msg.dashboardId.length > 0
  );
}

/**
 * Type guard for parent-bound messages emitted by the embedded plugin.
 */
export function isEmbedParentMessage(
  data: unknown
): data is EmbedParentMessage {
  if (!data || typeof data !== "object") {
    return false;
  }
  const msg = data as { type?: string };
  return (
    msg.type === EMBED_MESSAGE_TYPE.READY ||
    msg.type === EMBED_MESSAGE_TYPE.RENDERED ||
    msg.type === EMBED_MESSAGE_TYPE.ERROR
  );
}

/**
 * Build a switch-dashboard message from a payload (shared by both plugins).
 */
export function createSwitchDashboardMessage(
  payload: SwitchDashboardPayload
): SwitchDashboardMessage {
  return {
    type: EMBED_MESSAGE_TYPE.SWITCH,
    dashboardId: payload.dashboardId,
    timeRange: payload.timeRange,
    query: payload.query,
    filters: payload.filters,
    guestToken: payload.guestToken,
  };
}

/**
 * Send a switch-dashboard message to a DOM-free target.
 *
 * If the target supports `postMessage` (Kibana), the message is posted
 * directly. If the target supports `switchDashboard` (Superset SDK handle),
 * the SDK method is invoked instead. Both paths use the same payload shape.
 */
export function sendSwitchDashboardMessage(
  target: EmbedMessageTarget,
  payload: SwitchDashboardPayload,
  targetOrigin: string
): void {
  if (typeof target.switchDashboard === "function") {
    void target.switchDashboard(payload.dashboardId, payload.guestToken);
    return;
  }
  if (typeof target.postMessage === "function") {
    target.postMessage(createSwitchDashboardMessage(payload), targetOrigin);
    return;
  }
  throw new UnsupportedError(
    "EmbedMessageTarget must provide either postMessage or switchDashboard"
  );
}
