/**
 * @module integrations/graph/shared/types
 * @summary Frontend-safe graph type declarations.
 * @description Type aliases and interfaces that are safe to import from a
 * frontend bundle. Alongside the declarative graph metadata types (loop
 * condition DSL, switch cases, node metadata patches), this module carries the
 * DECAF-48 execution contract consumed by the frontend via SSE: the node/edge
 * state-change payloads, the structured run log entry, the node I/O
 * inspection payload, the run-scoped subscription ownership tuple, and the
 * Log-node level. All consumed over SSE — no engine runtime dependency.
 */
import type { GraphPortDefinition } from "@decaf-ts/ui-decorators/graph";

import type {
  GraphExecutionEventType,
  GraphExecutionStatus,
  GraphVisualState,
} from "./constants";

/**
 * A value reference inside a {@link ConditionExpression}.
 *
 * - `{ const: x }` — a literal constant.
 * - `{ path: "a.b" }` — a dotted path resolved against the current loop state.
 * - `{ step: "nodeId", path: "out" }` — a cross-node reference (resolved from
 *   the execution state in v1; reserved for future multi-step evaluation).
 */
export type ExprValue =
  | { const: unknown }
  | { path: string }
  | { step: string; path: string };

/**
 * Declarative, serializable condition expression DSL (ALFRED-5 §8 / DECAF-32 §22.3).
 *
 * The engine's `GraphConditionEvaluator` recognises this DSL when the
 * condition object carries an `op` field and dispatches to the
 * `ConditionExpressionEvaluator`.
 */
export type ConditionExpression =
  | { op: "eq"; left: ExprValue; right: ExprValue }
  | { op: "neq"; left: ExprValue; right: ExprValue }
  | { op: "gt"; left: ExprValue; right: ExprValue }
  | { op: "gte"; left: ExprValue; right: ExprValue }
  | { op: "lt"; left: ExprValue; right: ExprValue }
  | { op: "lte"; left: ExprValue; right: ExprValue }
  | { op: "and"; conditions: ConditionExpression[] }
  | { op: "or"; conditions: ConditionExpression[] }
  | { op: "not"; condition: ConditionExpression }
  | { op: "exists"; value: ExprValue };

/**
 * A code-based condition evaluated in a restricted VM sandbox (§22.4).
 *
 * The engine does NOT implement the sandbox directly — a pluggable
 * `CodeSandboxEvaluator` must be registered for code conditions to work.
 * The code must follow the same restrictions as the Code Node (§22.4):
 * no system API access, placeholder syntax for workflow data references.
 */
export interface CodeCondition {
  type: "code";
  code: string;
  language?: "javascript" | "typescript";
}

/**
 * A condition on a Switch case — either a declarative
 * {@link ConditionExpression} (graphical mode) or a {@link CodeCondition}
 * (code mode).
 */
export type SwitchCaseCondition = ConditionExpression | CodeCondition;

/**
 * A single case in a Switch node.
 *
 * Each case pairs a condition with a dedicated output port. When the
 * condition evaluates to `true`, the input is routed to `outputPort`.
 */
export interface SwitchCase {
  id: string;
  label: string;
  condition: SwitchCaseCondition;
  outputPort: string;
}

/**
 * Metadata for a Switch node, stored in `metadata.switch`.
 *
 * When `hasDefault` is `false` (the default), the `default` output port is
 * hidden and the executor throws a `GraphExecutionError` when no case
 * matches. When `hasDefault` is `true`, the `default` output port is visible
 * and receives the input when no case matches (DECAF-34 §6.2).
 */
export interface SwitchNodeMetadata {
  cases: SwitchCase[];
  defaultPort?: string;
  hasDefault?: boolean;
}

/**
 * The result of applying a metadata change to a node. Each concrete node
 * class that overrides `GraphNode.applyMetadata()` returns this so the
 * renderer can update the diagram model — the node owns its ports, its
 * size, and any data patches.
 */
export interface NodeMetadataChange {
  ports: GraphPortDefinition[];
  size: { width: number; height: number };
  dataPatch: Record<string, unknown>;
}

/**
 * Serialized error payload included in execution events and results.
 *
 * Frontend-safe: the frontend receives this over SSE when a node or workflow
 * fails and needs to render the error details.
 */
export interface GraphExecutionErrorPayload {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  details?: unknown;
}

/**
 * A single event emitted during graph execution.
 *
 * Frontend-safe: the frontend consumes these events over the SSE endpoint
 * (`GET /graph/events`) and maps them to UI state updates via
 * `GraphExecutionStateMapper`. The `timestamp` is serialised as an ISO string
 * over the wire; the frontend deserialises it back to a `Date` when mapping.
 */
export interface GraphExecutionEvent {
  id: string;
  sequence: number;
  runId: string;
  parentRunId?: string;
  workflowId: string;
  type: GraphExecutionEventType;
  timestamp: Date;
  nodeId?: string;
  edgeId?: string;
  port?: string;
  iteration?: number;
  path: string[];
  status?: GraphExecutionStatus;
  payload?: unknown;
  error?: GraphExecutionErrorPayload;
  metadata?: Record<string, unknown>;
}

/**
 * Payload carried by `NODE_STATE_CHANGED` events (DECAF-48 §4.4).
 *
 * The visual state is the engine-agnostic contract a Mastra/NestJS driver
 * MUST emit; the reference engine derives it from its own execution events.
 */
export interface GraphNodeStateChangedPayload {
  nodeId: string;
  state: GraphVisualState;
  runId: string;
  workflowId: string;
  /** Engine status that produced the visual state (when available). */
  status?: GraphExecutionStatus;
  iteration?: number;
}

/**
 * Payload carried by `EDGE_STATE_CHANGED` events (DECAF-48 §4.4).
 */
export interface GraphEdgeStateChangedPayload {
  edgeId: string;
  state: GraphVisualState;
  runId: string;
  workflowId: string;
  /** Source node of the routed edge (when available). */
  nodeId?: string;
  /** Engine status that produced the visual state (when available). */
  status?: GraphExecutionStatus;
}

/**
 * Structured log line streamed over the `graph.run.log` SSE channel
 * (DECAF-48 §4.3). Serialized from the run's `ctx.logger` output; the level
 * drives the Chrome-console-style filter while the attributes render as
 * discrete columns.
 */
export interface GraphRunLogEntry {
  /** Log severity level driving the Chrome-console-style widget filter (all `LogNodeLevel` values plus `benchmark`). */
  level: "silly" | "trace" | "debug" | "verbose" | "info" | "warn" | "error" | "critical" | "fatal" | "benchmark";
  message: string;
  timestamp: string;
  runId: string;
  workflowId: string;
  nodeId?: string;
  user?: string | null;
  /** Structured payload associated with the log line, if any. */
  payload?: unknown;
}

/**
 * Structured per-node I/O payload exposed for node inspection (DECAF-48 §4.6).
 *
 * Frontend-safe: pure data delivered via `graph/shared` types over the SSE
 * state channel (or a `GET /graph/results/:runId` lookup); the frontend
 * renders both panes (inputs right, outputs/error left) from this one shape.
 */
export interface GraphNodeInspectionPayload {
  runId: string;
  workflowId: string;
  nodeId: string;
  state: GraphVisualState;
  inputs: Record<string, unknown>;
  /** Present when SUCCEEDED (or from cache). */
  outputs?: Record<string, unknown>;
  /** Present when FAILED. */
  error?: GraphExecutionErrorPayload;
}

/**
 * Log levels accepted by the Log node (DECAF-48 §4.3).
 *
 * Mirrors the DECAF-9 log level set so the Log node executor (and the
 * {@link GraphRunLogger} dispatch) can forward onto the run's `ctx.logger`.
 * Includes every level rendered by the Chrome-console-style widget filter.
 */
export type LogNodeLevel =
  | "silly"
  | "trace"
  | "debug"
  | "verbose"
  | "info"
  | "warn"
  | "error"
  | "critical"
  | "fatal";

/**
 * Run-scoped SSE subscription ownership key (DECAF-48 §4.2).
 *
 * Subscription-mode SSE is keyed by run ownership: a consumer is only
 * delivered graph events/logs for runs it owns. This tuple is the
 * engine-agnostic contract a Mastra/NestJS driver MUST honour —
 * `runId` together with the owning `user` (or a `system` runner when the
 * identity is absent) scope every `graph.run.*` event before `next(...)`.
 */
export interface GraphRunSubscription {
  runId: string;
  ownerUser: string | null;
  /** Optional topic filter (e.g. `graph.run.log`, `graph.run.state`). */
  topics?: string[];
}
