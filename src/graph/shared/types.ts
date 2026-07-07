/**
 * @module integrations/graph/shared/types
 * @summary Frontend-safe graph type declarations.
 * @description Type aliases and interfaces that are safe to import from a
 * frontend bundle. These types describe declarative graph metadata (loop
 * condition DSL, switch cases, node metadata patches) and the execution-event
 * data contract consumed by the frontend via SSE — no engine runtime
 * dependency.
 */
import type { GraphPortDefinition } from "@decaf-ts/ui-decorators/graph";

import type { GraphExecutionEventType, GraphExecutionStatus } from "./constants";

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
 */
export interface SwitchNodeMetadata {
  cases: SwitchCase[];
  defaultPort?: string;
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
