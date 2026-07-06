/**
 * @module integrations/nest/graph/GraphExecutionResultRepository
 * @summary Repository for persisting and retrieving graph execution results.
 * @description Provides a typed handle to a Decaf {@link Repository} backed by RamAdapter, with convenience methods for saving and loading {@link GraphExecutionResultModel} records. The repository is created via `Repository.forModel()` so it inherits all standard Decaf CRUD operations.
 */
import { Repository } from "@decaf-ts/core";
import type { GraphExecutionResult } from "../../graph";
import { GraphExecutionResultModel } from "./GraphExecutionResultModel";

/**
 * Type alias for the Decaf repository typed to {@link GraphExecutionResultModel}.
 */
export type GraphExecutionResultRepositoryInstance =
  Repository<GraphExecutionResultModel, any>;

/**
 * Creates a Decaf repository for {@link GraphExecutionResultModel}.
 *
 * The caller must ensure the RamAdapter has been initialised and set as the
 * current adapter (via `RamAdapter.decoration()` and `Adapter.setCurrent()`)
 * before invoking this factory.
 *
 * @returns A Decaf repository instance for {@link GraphExecutionResultModel}.
 */
export function createGraphExecutionResultRepository() {
  return Repository.forModel(GraphExecutionResultModel);
}

/**
 * Converts a {@link GraphExecutionResult} into a persistable
 * {@link GraphExecutionResultModel}.
 *
 * @param result - The execution result to convert.
 * @returns A model instance ready for persistence.
 */
export function toResultModel(
  result: GraphExecutionResult
): GraphExecutionResultModel {
  return new GraphExecutionResultModel({
    runId: result.runId,
    workflowId: result.workflowId,
    status: result.status,
    inputs: result.inputs,
    outputs: result.outputs,
    nodeResults: result.nodeResults as Record<string, unknown>,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  });
}

/**
 * Converts a persisted {@link GraphExecutionResultModel} back into a plain
 * result-like object suitable for API responses.
 *
 * @param model - The persisted model (or `null` if not found).
 * @returns A plain object with the result fields, or `null`.
 */
export function fromResultModel(
  model: GraphExecutionResultModel | null
): Omit<GraphExecutionResult, "workflow" | "events" | "metadata"> | null {
  if (!model) return null;
  return {
    runId: model.runId,
    workflowId: model.workflowId,
    status: model.status as GraphExecutionResult["status"],
    inputs: model.inputs,
    outputs: model.outputs,
    nodeResults: model.nodeResults as GraphExecutionResult["nodeResults"],
    startedAt: model.startedAt,
    finishedAt: model.finishedAt,
  };
}
