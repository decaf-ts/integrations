/**
 * @module integrations/graph/engine/types
 * @summary Graph execution engine core types.
 * @description Engine-private type aliases and interfaces. Frontend-safe
 * types (`ExprValue`, `ConditionExpression`, `CodeCondition`,
 * `SwitchCaseCondition`, `SwitchCase`, `SwitchNodeMetadata`,
 * `NodeMetadataChange`, `GraphExecutionEvent`, `GraphExecutionErrorPayload`)
 * live in `../shared/types`; engine modules import shared symbols from there
 * and engine-private symbols from here.
 */
import type {
  GraphNodeDefinition,
  GraphWorkflowDefinition,
} from "@decaf-ts/ui-decorators/graph";

import type {
  GraphExecutionEventType,
  GraphExecutionStatus,
} from "../shared/constants";
import type {
  GraphExecutionErrorPayload,
  GraphExecutionEvent,
} from "../shared/types";

// Re-export frontend-safe types so engine modules have a single import surface.
export type {
  GraphExecutionErrorPayload,
  GraphExecutionEvent,
} from "../shared/types";

/**
 * Unique identifier for a single graph execution run.
 */
export type GraphRunId = string;

/**
 * Identifier for a workflow definition.
 */
export type GraphWorkflowId = string;

/**
 * Identifier for a node within a workflow.
 */
export type GraphNodeId = string;

/**
 * Name of a port on a node or workflow boundary.
 */
export type GraphPortName = string;

/**
 * A bag of named values exchanged between nodes and the workflow boundary.
 */
export type GraphExecutionValues = Record<string, unknown>;

/**
 * Options that influence a single execution of a workflow.
 */
export interface GraphExecutionOptions {
  runId?: GraphRunId;
  parentRunId?: GraphRunId;
  workflowId?: GraphWorkflowId;
  path?: string[];
  concurrency?: number;
  failFast?: boolean;
  validateInputs?: boolean;
  validateOutputs?: boolean;
  maxLoopIterations?: number;
  maxForeachIterations?: number;
  usePinnedValues?: boolean;
  writeThroughCache?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Result of executing a single node.
 */
export interface GraphNodeExecutionResult {
  nodeId: GraphNodeId;
  status: GraphExecutionStatus;
  inputs: GraphExecutionValues;
  outputs?: GraphExecutionValues;
  error?: GraphExecutionErrorPayload;
  startedAt: Date;
  finishedAt?: Date;
  fromCache?: boolean;
  pinned?: boolean;
  events: GraphExecutionEvent[];
}

/**
 * Result of executing an entire workflow.
 */
export interface GraphExecutionResult {
  runId: GraphRunId;
  parentRunId?: GraphRunId;
  workflowId: GraphWorkflowId;
  status: GraphExecutionStatus;
  workflow: GraphWorkflowDefinition;
  inputs: GraphExecutionValues;
  outputs: GraphExecutionValues;
  nodeResults: Record<GraphNodeId, GraphNodeExecutionResult>;
  events: GraphExecutionEvent[];
  startedAt: Date;
  finishedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Options used to construct a {@link GraphExecutionContext}.
 */
export interface GraphExecutionContextOptions {
  runId: GraphRunId;
  parentRunId?: GraphRunId;
  workflow: GraphWorkflowDefinition;
  node: GraphNodeDefinition;
  path: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Metadata describing a loop node's behaviour.
 */
export interface GraphLoopMetadata {
  body: GraphWorkflowDefinition | unknown;
  maxIterations?: number;
  timeoutMs?: number;
  condition?: GraphConditionDefinition;
  concurrency?: number;
  inputPort?: string;
  outputPort?: string;
  itemPort?: string;
  resultPort?: string;
  statePort?: string;
}

/**
 * Definition of a condition evaluated by the loop condition evaluator.
 *
 * When the condition object carries an `op` field (see {@link ConditionExpression}),
 * the {@link GraphConditionEvaluator} dispatches to the {@link ConditionExpressionEvaluator}
 * instead of the built-in `type`-based switch.
 */
export interface GraphConditionDefinition {
  type:
    | "truthy"
    | "falsy"
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "greaterThanOrEqual"
    | "lessThan"
    | "lessThanOrEqual"
    | "exists"
    | "custom";
  left?: string;
  right?: unknown;
  evaluator?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Pinning metadata attached to a node via `@pinnable()`.
 */
export interface GraphPinningMetadata {
  enabled: boolean;
  ttlMs?: number;
  strategy: "manual" | "automatic" | "disabled";
  includeDependencies: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Options for pinning a node after a completed run.
 */
export interface GraphPinNodeOptions {
  workflow: GraphWorkflowDefinition;
  plan: unknown;
  result: GraphExecutionResult;
  nodeId: string;
  includeDependencies?: boolean;
  namespace?: string;
}

/**
 * Options for unpinning a node.
 */
export interface GraphUnpinNodeOptions {
  workflow: GraphWorkflowDefinition;
  nodeId: string;
  fingerprint: string;
  namespace?: string;
}

/**
 * A patch applied to a graph workflow snapshot after execution.
 */
export interface GraphExecutionSnapshotPatch {
  runId: string;
  status: GraphExecutionStatus;
  nodes: Record<
    string,
    {
      status: GraphExecutionStatus;
      startedAt?: string;
      finishedAt?: string;
      error?: GraphExecutionErrorPayload;
      outputs?: Record<string, unknown>;
      fromCache?: boolean;
      pinned?: boolean;
    }
  >;
  edges: Record<
    string,
    {
      status: GraphExecutionStatus;
      lastValue?: unknown;
      updatedAt: string;
    }
  >;
  outputs: Record<string, unknown>;
  events: GraphExecutionEvent[];
}
