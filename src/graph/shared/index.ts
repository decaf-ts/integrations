/**
 * @module integrations/graph/shared
 * @summary Frontend-safe graph declarations.
 * @description Subpath export for frontend bundles. Re-exports the node kind
 * declarations, shared types, and shared constants — no engine runtime
 * dependency. Also re-exports `Metadata` from `@decaf-ts/ui-decorators` so
 * consumers get the `Metadata.nodes()` / `Metadata.workflows()` accessors
 * (attached via the graph overrides side-effect import).
 *
 * Importing anything from this module triggers the `ui-decorators/graph`
 * overrides side-effect, which attaches `nodes()` / `workflows()` to the
 * `Metadata` class.
 */
import "@decaf-ts/ui-decorators/graph";

export { Metadata } from "@decaf-ts/decoration";
export * from "./constants";
export * from "./types";
export * from "./GraphExecutionStateMapper";
export * from "./nodes";

// Re-export the ui-decorators graph metadata the frontend needs so `for-angular`
// imports only `@decaf-ts/integrations/graph/shared` (DECAF-35 §4.6 ESLint
// boundary / DECAF-48 §4.1): visual-state overlay styles and node I/O
// inspection metadata.
export {
  GRAPH_VISUAL_STATE_STYLES,
  graphVisualStyleOf,
} from "@decaf-ts/ui-decorators/graph";
export type {
  GraphNodeIoMetadata,
  GraphNodeIoViewMode,
  GraphVisualStyle,
} from "@decaf-ts/ui-decorators/graph";
