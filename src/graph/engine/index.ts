/**
 * @module integrations/graph/engine
 * @summary Graph execution engine (backend-only).
 * @description Reference interpreter for Decaf graph workflows. Executes
 * workflows declared with `@decaf-ts/ui-decorators/graph`, emits events
 * through Decaf's Observable pipeline, supports structured loops, configurable
 * value stores, and pinnable/cacheable nodes.
 *
 * Re-exports `../shared` so backend consumers have a single import surface.
 */

// Re-export frontend-safe declarations so backend consumers have one surface.
export * from "../shared";

export * from "./constants";
export * from "./types";
export * from "./decorators";

export * from "./errors/GraphExecutionError";
export * from "./errors/GraphCycleError";
export * from "./errors/GraphInputError";
export * from "./errors/GraphLoopLimitError";
export * from "./errors/GraphPinningError";
export * from "./errors/GraphPortError";
export * from "./errors/GraphStoreError";
export * from "./errors/GraphTopologyError";

export * from "./events/GraphExecutionEvent";
export * from "./events/GraphExecutionObserver";
export * from "./events/GraphExecutionEventEmitter";
export * from "./events/GraphExecutionEventFactory";

export * from "./execution/GraphExecutionContext";
export * from "./execution/GraphNodeExecutor";
export * from "./execution/GraphExecutionFrame";
export * from "./execution/GraphExecutionResult";
export * from "./execution/GraphExecutionEngine";
export * from "./execution/CodeSandboxEvaluator";
export * from "./execution/SwitchGraphNodeExecutor";

export * from "./registry/GraphNodeExecutorRegistry";
export * from "./registry/GraphNodeExecutorResolver";

export * from "./store/GraphValueKey";
export * from "./store/GraphCachedValue";
export * from "./store/GraphValueStoreAdapter";
export * from "./store/InMemoryGraphValueStoreAdapter";
export * from "./store/GraphValueStore";

export * from "./planning/GraphExecutionPlanNode";
export * from "./planning/GraphExecutionPlanEdge";
export * from "./planning/GraphExecutionPlanLayer";
export * from "./planning/GraphExecutionPlan";
export * from "./planning/GraphRelationResolver";
export * from "./planning/GraphExecutionPlanner";
export * from "./planning/GraphTopology";

// Validation (TASK-215)
export * from "./validation/GraphDefinitionValidator";
export * from "./validation/GraphPortSchemaResolver";
export * from "./validation/GraphValueValidator";

// Loops (TASK-216)
export * from "./loops/GraphConditionEvaluator";
export * from "./loops/ConditionExpressionEvaluator";
export * from "./loops/GraphLoopExecutionContext";
export * from "./loops/ForeachGraphNodeExecutor";
export * from "./loops/WhileGraphNodeExecutor";
export * from "./loops/UntilGraphNodeExecutor";

// Pinning (TASK-217/218)
export * from "./pinning/GraphPinningMetadata";
export * from "./pinning/GraphPinningPolicy";
export * from "./pinning/GraphPinningDependencyResolver";
export * from "./pinning/GraphPinningService";

// Snapshots (TASK-219)
export * from "./snapshots/GraphExecutionSnapshotMapper";
