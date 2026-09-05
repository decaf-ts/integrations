/**
 * @module integrations/graph
 * @summary Decaf Graph Execution Engine (backend convenience export).
 * @description Re-exports `./engine` (all engine modules). Backend consumers
 * import from `@decaf-ts/integrations/graph` and get a single unified surface.
 *
 * Frontend-safe shared declarations (node kinds, types, constants) live in
 * `@decaf-ts/ui-decorators/graph` — frontend bundles MUST import from there
 * to avoid pulling in the execution engine.
 */
import "./log/LogParameters";
export * from "./engine";
