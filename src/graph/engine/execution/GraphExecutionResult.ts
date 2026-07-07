/**
 * @module integrations/graph/execution/GraphExecutionResult
 * @summary Helper for building GraphExecutionResult objects.
 * @description Provides a builder function that assembles a result from a frame.
 */
import type { GraphExecutionFrame } from "./GraphExecutionFrame";
import type { GraphExecutionEvent, GraphExecutionResult, GraphExecutionValues, GraphNodeExecutionResult, GraphRunId } from "../types";
import type { GraphExecutionStatus } from "../../shared/constants";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

/**
 * Builds a {@link GraphExecutionResult} from a completed frame.
 */
export function buildGraphExecutionResult(
  frame: GraphExecutionFrame,
  workflow: GraphWorkflowDefinition,
  inputs: GraphExecutionValues,
  status: GraphExecutionStatus,
  metadata?: Record<string, unknown>
): GraphExecutionResult {
  const outputs = frame.valueStore.getWorkflowValues();
  const nodeResults: Record<string, GraphNodeExecutionResult> = {};
  for (const [id, result] of frame.nodeResults) {
    nodeResults[id] = result;
  }
  const events: GraphExecutionEvent[] = [...frame.events];
  const runId: GraphRunId = frame.runId;

  return {
    runId,
    workflowId: workflow.name,
    status,
    workflow,
    inputs: { ...inputs },
    outputs,
    nodeResults,
    events,
    startedAt: frame.startedAt,
    finishedAt: frame.finishedAt,
    metadata,
  };
}
