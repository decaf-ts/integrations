/**
 * @module integrations/graph/shared/constants
 * @summary Frontend-safe graph constants and enums.
 * @description Constants and enumerations that are safe to import from a
 * frontend bundle (no engine runtime dependency). Alongside the existing
 * execution-status and event-type enums (rendered as status badges and event
 * timelines), this module carries the DECAF-48 visual-state contract: the
 * frontend-safe {@link GraphVisualState} enum, the `graph.run.log` /
 * `graph.run.state` SSE topic constants, the run-log attribute keys
 * ({@link GraphLogAttribute}), and the `NODE_STATE_CHANGED` /
 * `EDGE_STATE_CHANGED` / `GRAPH_RUN_LOG` event types, plus the DECAF-50 run
 * contract: {@link GraphRunLimits} (with {@link DEFAULT_GRAPH_RUN_LIMITS}) and
 * the run lifecycle/terminal predicates (`isGraphRunStatus`,
 * `isGraphRunTerminalStatus`, `isGraphRunTerminalEventType`). The frontend
 * must not pull in the execution engine.
 */

import type { GraphRunStatus } from "./types";

/**
 * Disabled-node execution semantics (DECAF-50 §4.9).
 *
 * - `skip` — the node does not execute and produces no outputs.
 * - `passThroughFirstInput` — the first incoming edge value is forwarded on
 *   the node's first declared output port.
 * - `emitDefaults` — every declared output port is emitted with its default
 *   (absent a declared default, `undefined`).
 */
export const GRAPH_DISABLED_NODE_BEHAVIORS = [
  "skip",
  "passThroughFirstInput",
  "emitDefaults",
] as const;

/** How a disabled node behaves during execution (DECAF-50 §4.8): skip it, pass through its first input, or emit default outputs. */
export type GraphDisabledNodeBehavior = (typeof GRAPH_DISABLED_NODE_BEHAVIORS)[number];

/** The disabled-node behavior applied when a node declares none. */
export const GRAPH_DEFAULT_DISABLED_NODE_BEHAVIOR: GraphDisabledNodeBehavior = "skip";

/** Type guard for {@link GraphDisabledNodeBehavior}. */
export function isGraphDisabledNodeBehavior(
  value: unknown
): value is GraphDisabledNodeBehavior {
  return (GRAPH_DISABLED_NODE_BEHAVIORS as readonly string[]).includes(
    value as string
  );
}

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
 * Visual execution state for a node or edge on the workflow canvas.
 *
 * Frontend-safe (DECAF-48 §4.4): a superset of {@link GraphExecutionStatus}
 * normalised for rendering. `BLOCKED` is derived from the plan and execution
 * events (waiting on upstream dependencies), not emitted as an engine status.
 * `SKIPPED` is the post-failure "unexecuted/disabled" visual state.
 */
export enum GraphVisualState {
  IDLE = "idle",
  RUNNING = "running",
  BLOCKED = "blocked",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  SKIPPED = "skipped",
}


/**
 * Namespace root for graph run SSE topics (DECAF-48 §4.2). A subscription
 * filters on these granular topics before `observer.next(...)`.
 */
export const GRAPH_RUN_TOPIC = "graph.run";

/**
 * SSE sub-topic streaming per-node log lines during a run.
 */
export const GRAPH_RUN_LOG_TOPIC = `${GRAPH_RUN_TOPIC}.log`;

/**
 * SSE sub-topic streaming node/edge execution-state updates during a run.
 */
export const GRAPH_RUN_STATE_TOPIC = `${GRAPH_RUN_TOPIC}.state`;

/**
 * Logger custom-attribute keys attached to every run log line via
 * DECAF-9 `logger.for({...})` (DECAF-48 §4.3). Rendered as discrete columns
 * (not buried in the message string).
 */
export enum GraphLogAttribute {
  NODE_ID = "nodeId",
  WORKFLOW_ID = "workflowId",
  RUN_ID = "runId",
  USER = "user",
}

/**
 * Namespace topic helper for a graph execution event.
 *
 * Log-carrier events resolve to `graph.run.log`; node/edge execution-state
 * events resolve to `graph.run.state`; everything else stays under the shared
 * `graph.run` topic and is only delivered to subscribers that match it.
 *
 * @param eventType - The graph execution event type to scope to a topic.
 * @returns The SSE topic constant for the given event type.
 */
export function graphRunTopicOf(eventType: GraphExecutionEventType): string {
  switch (eventType) {
    case GraphExecutionEventType.GRAPH_RUN_LOG:
      return GRAPH_RUN_LOG_TOPIC;
    case GraphExecutionEventType.NODE_STATE_CHANGED:
    case GraphExecutionEventType.EDGE_STATE_CHANGED:
      return GRAPH_RUN_STATE_TOPIC;
    default:
      return GRAPH_RUN_TOPIC;
  }
}

/**
 * Event types emitted through the graph execution observer pipeline.
 *
 * DECAF-48 extends this set with the visual-state and run-log event types the
 * engine emits on the existing Observable: {@link GraphExecutionEventType.NODE_STATE_CHANGED},
 * {@link GraphExecutionEventType.EDGE_STATE_CHANGED} and
 * {@link GraphExecutionEventType.GRAPH_RUN_LOG}.
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
  /** Node execution-state transition carrying a `GraphNodeStateChangedPayload` (DECAF-48 §4.4). */
  NODE_STATE_CHANGED = "node.stateChanged",

  EDGE_VALUE_ROUTED = "edge.valueRouted",
  /** Edge execution-state transition carrying a `GraphEdgeStateChangedPayload` (DECAF-48 §4.4). */
  EDGE_STATE_CHANGED = "edge.stateChanged",

  /** Structured run log line carrying a `GraphRunLogEntry` (DECAF-48 §4.3). */
  GRAPH_RUN_LOG = "graph.run.log",

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
 * Hard limits for the graph run subsystem (DECAF-50 §4.14/§4.16).
 *
 * Enforced by the run executor and the HTTP run controller; every omitted
 * field falls back to {@link DEFAULT_GRAPH_RUN_LIMITS}.
 */
export interface GraphRunLimits {
  /** Maximum serialised JSON size accepted for a run create request. */
  maxRequestBytes?: number;
  /**
   * Maximum number of runs in flight per caller: the run's owner user, or
   * the caller-key bucket supplied by the HTTP layer for anonymous callers
   * (per-IP where the host exposes it, a shared `"anonymous"` bucket
   * otherwise).
   */
  maxConcurrentRuns?: number;
  /** Maximum events retained per run by the in-memory event store. */
  maxEventsPerRun?: number;
  /** Maximum serialised size of a single event envelope `payload`. */
  maxEventPayloadBytes?: number;
  /** Hard wall-clock budget for a run's engine execution. */
  executionTimeoutMs?: number;
  /**
   * How long a terminal run's replayable event state is kept after the run
   * finishes before being released (SAA-595 resource governance).
   */
  eventReplayWindowMs?: number;
}

/** Default run limits: request size, per-caller concurrency, event retention/payload size, execution timeout, and post-terminal event replay window. */
export const DEFAULT_GRAPH_RUN_LIMITS: Required<GraphRunLimits> = {
  maxRequestBytes: 4_000_000,
  maxConcurrentRuns: 32,
  maxEventsPerRun: 10_000,
  maxEventPayloadBytes: 256_000,
  executionTimeoutMs: 600_000,
  eventReplayWindowMs: 300_000,
};

/**
 * Terminal graph event types closing a run's SSE stream
 * (DECAF-50 §4.15). The run SSE endpoint never emits anything after these.
 */
export const GRAPH_RUN_TERMINAL_EVENT_TYPES: readonly GraphExecutionEventType[] =
  [
    GraphExecutionEventType.WORKFLOW_COMPLETED,
    GraphExecutionEventType.WORKFLOW_FAILED,
    GraphExecutionEventType.WORKFLOW_CANCELLED,
  ];

/** Whether the event type is a run-stream terminal type (see {@link GRAPH_RUN_TERMINAL_EVENT_TYPES}). */
export function isGraphRunTerminalEventType(
  type: GraphExecutionEventType
): boolean {
  return GRAPH_RUN_TERMINAL_EVENT_TYPES.includes(type);
}

/** Whether the run status is terminal (`succeeded`, `failed`, or `cancelled`). */
export function isGraphRunTerminalStatus(status: GraphRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** Type guard for {@link GraphRunStatus}. */
export function isGraphRunStatus(value: unknown): value is GraphRunStatus {
  return (
    typeof value === "string" &&
    [
      "queued",
      "validating",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ].includes(value)
  );
}
