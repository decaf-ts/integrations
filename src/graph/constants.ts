/**
 * @module integrations/graph/constants
 * @summary Graph execution engine constants and enums.
 * @description Shared constants, default limits, and enumerations used across the graph execution engine.
 */

/**
 * Boundary identifier used as the node id for workflow-level input/output ports.
 */
export const GRAPH_WORKFLOW_BOUNDARY = "$workflow";

/**
 * Default concurrency for parallel node execution within a layer.
 */
export const GRAPH_DEFAULT_CONCURRENCY = 4;

/**
 * Default maximum iterations for `while` and `until` loop nodes.
 */
export const GRAPH_DEFAULT_MAX_LOOP_ITERATIONS = 100;

/**
 * Default maximum iterations for `foreach` loop nodes.
 */
export const GRAPH_DEFAULT_MAX_FOREACH_ITERATIONS = 1000;

/**
 * Metadata key under which pinning information is stored on a graph node.
 */
export const GRAPH_PINNING_METADATA_KEY = "graph.pinnable";

/**
 * Execution status for a workflow or individual node.
 */
export enum GraphExecutionStatus {
  PENDING = "pending",
  PLANNING = "planning",
  RUNNING = "running",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  SKIPPED = "skipped",
  CANCELLED = "cancelled",
  CACHED = "cached",
}

/**
 * Event types emitted through the graph execution observer pipeline.
 */
export enum GraphExecutionEventType {
  WORKFLOW_STARTED = "workflow.started",
  WORKFLOW_PLANNED = "workflow.planned",
  WORKFLOW_COMPLETED = "workflow.completed",
  WORKFLOW_FAILED = "workflow.failed",
  WORKFLOW_CANCELLED = "workflow.cancelled",

  NODE_QUEUED = "node.queued",
  NODE_STARTED = "node.started",
  NODE_OUTPUT = "node.output",
  NODE_COMPLETED = "node.completed",
  NODE_FAILED = "node.failed",
  NODE_SKIPPED = "node.skipped",
  NODE_CACHE_HIT = "node.cacheHit",
  NODE_PINNED = "node.pinned",
  NODE_UNPINNED = "node.unpinned",

  EDGE_VALUE_ROUTED = "edge.valueRouted",

  LOOP_STARTED = "loop.started",
  LOOP_ITERATION_STARTED = "loop.iteration.started",
  LOOP_ITERATION_COMPLETED = "loop.iteration.completed",
  LOOP_CONDITION_EVALUATED = "loop.condition.evaluated",
  LOOP_COMPLETED = "loop.completed",
  LOOP_LIMIT_REACHED = "loop.limitReached",

  VALIDATION_STARTED = "validation.started",
  VALIDATION_FAILED = "validation.failed",
  VALIDATION_COMPLETED = "validation.completed",

  STORE_READ = "store.read",
  STORE_WRITE = "store.write",
  STORE_DELETE = "store.delete",
}

/**
 * Pinning strategy determining when values are pinned.
 */
export enum GraphPinningStrategy {
  MANUAL = "manual",
  AUTOMATIC = "automatic",
  DISABLED = "disabled",
}

/**
 * Built-in condition types supported by the loop condition evaluator.
 */
export enum GraphConditionType {
  TRUTHY = "truthy",
  FALSY = "falsy",
  EQUALS = "equals",
  NOT_EQUALS = "notEquals",
  GREATER_THAN = "greaterThan",
  GREATER_THAN_OR_EQUAL = "greaterThanOrEqual",
  LESS_THAN = "lessThan",
  LESS_THAN_OR_EQUAL = "lessThanOrEqual",
  EXISTS = "exists",
  CUSTOM = "custom",
}

/**
 * Loop node kinds recognised by the engine.
 */
export const GRAPH_LOOP_KIND = {
  FOREACH: "core.loop.foreach",
  WHILE: "core.loop.while",
  UNTIL: "core.loop.until",
} as const;
