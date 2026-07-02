/**
 * @module integrations/graph/execution/GraphNodeExecutor
 * @summary Interface implemented by every graph node executor.
 * @description A node executor receives the node's resolved input values and a {@link GraphExecutionContext}, and returns the node's output values.
 */
import type { GraphExecutionContext } from "./GraphExecutionContext";
import type { GraphExecutionValues } from "../types";

/**
 * Executor for a specific graph node kind.
 *
 * Implementations are registered in the {@link GraphNodeExecutorRegistry}
 * and resolved by the engine using the node's `kind`.
 */
export interface GraphNodeExecutor<
  Input extends GraphExecutionValues = GraphExecutionValues,
  Output extends GraphExecutionValues = GraphExecutionValues,
> {
  /**
   * Executes the node logic.
   *
   * @param input - Resolved input values keyed by port name.
   * @param context - Decaf context for emitting progress and events.
   * @returns The node's output values keyed by port name.
   */
  execute(
    input: Input,
    context: GraphExecutionContext
  ): Promise<Output> | Output;
}
