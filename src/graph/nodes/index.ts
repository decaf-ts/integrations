/**
 * @module integrations/graph/nodes
 * @summary Production node kind declarations (DECAF-32 §22.2).
 * @description Canonical `@node`-decorated classes for the ALFRED-5 node kind
 * taxonomy. These are the framework's built-in node definitions — triggers
 * (§22.2.1), flow-control/utility nodes (§22.2.2–22.2.3), and the Agent node
 * (§21.3). The three loop kinds (`core.loop.foreach/while/until`) already have
 * built-in executors (§5.9) and are not redeclared here.
 *
 * Consumers (for-angular, ALFRED, etc.) import these declarations to populate
 * node palettes, registries, and reference snapshots.
 */
export * from "./category-styles";
export * from "./triggers";
export * from "./flow-control";
export * from "./agent";
