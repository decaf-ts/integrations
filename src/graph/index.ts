/**
 * @module integrations/graph
 * @summary Decaf Graph Execution Engine (backend convenience export).
 * @description Re-exports `./engine`, which in turn re-exports `./shared`
 * (frontend-safe declarations) plus all engine modules. Backend consumers
 * import from `@decaf-ts/integrations/graph` and get a single unified surface.
 *
 * Frontend bundles MUST import from `@decaf-ts/integrations/graph/shared`
 * instead to avoid pulling in the execution engine.
 */
export * from "./engine";
