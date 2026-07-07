/**
 * @module integrations/graph/loops/ForeachGraphNodeExecutor
 * @summary Foreach loop node executor.
 * @description Executes a body workflow once per item in the input array, collecting results in order.
 */
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import type { GraphExecutionContext } from "../execution/GraphExecutionContext";
import type { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import type { GraphExecutionValues, GraphLoopMetadata } from "../types";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import { GRAPH_DEFAULT_MAX_FOREACH_ITERATIONS } from "../constants";
import { GraphExecutionEventType } from "../../shared/constants";
import { GraphInputError } from "../errors/GraphInputError";
import { GraphLoopLimitError } from "../errors/GraphLoopLimitError";

/**
 * Executor for `core.loop.foreach` nodes.
 *
 * Expects input:
 * - `items`: array of values to iterate over
 * - `state?`: optional initial state
 *
 * Produces output:
 * - `results`: array of body outputs (in item order)
 * - `state?`: final state
 * - `iterations`: number of iterations executed
 */
export class ForeachGraphNodeExecutor implements GraphNodeExecutor {
  constructor(private readonly engine: GraphExecutionEngine) {}

  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const metadata = this.extractMetadata(context);
    const items = input.items;
    const maxIterations =
      metadata.maxIterations ?? GRAPH_DEFAULT_MAX_FOREACH_ITERATIONS;

    if (!Array.isArray(items)) {
      throw new GraphInputError("foreach input 'items' must be an array");
    }
    if (items.length > maxIterations) {
      throw new GraphLoopLimitError(
        `foreach exceeded max iterations (${items.length} > ${maxIterations})`
      );
    }

    const itemPort = metadata.itemPort ?? "item";
    const resultPort = metadata.resultPort ?? "result";
    const statePort = metadata.statePort ?? "state";
    const bodyWorkflow = metadata.body as GraphWorkflowDefinition;

    const results: unknown[] = [];
    let state = input.state;

    await context.emit({ type: GraphExecutionEventType.LOOP_STARTED });

    for (let i = 0; i < items.length; i++) {
      await context.emit({
        type: GraphExecutionEventType.LOOP_ITERATION_STARTED,
        iteration: i,
      });

      const childInputs: GraphExecutionValues = {
        [itemPort]: items[i],
        index: i,
      };
      if (state !== undefined) childInputs[statePort] = state;

      const childResult = await this.engine.execute(
        bodyWorkflow,
        childInputs,
        {
          parentRunId: context.runId,
          path: [...context.path, `iteration:${i}`],
        }
      );

      results.push(childResult.outputs[resultPort]);
      if (childResult.outputs[statePort] !== undefined) {
        state = childResult.outputs[statePort];
      }

      await context.emit({
        type: GraphExecutionEventType.LOOP_ITERATION_COMPLETED,
        iteration: i,
      });
    }

    await context.emit({ type: GraphExecutionEventType.LOOP_COMPLETED });

    const output: GraphExecutionValues = {
      results,
      iterations: items.length,
    };
    if (state !== undefined) output[statePort] = state;
    return output;
  }

  private extractMetadata(context: GraphExecutionContext): GraphLoopMetadata {
    const raw = (context.node as any).graph?.metadata?.loop ??
      (context.metadata as any)?.loop;
    if (!raw) {
      throw new GraphInputError("foreach node is missing loop metadata");
    }
    return raw as GraphLoopMetadata;
  }
}
