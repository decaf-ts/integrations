/**
 * @module integrations/graph/loops/ForeachGraphNodeExecutor
 * @summary Foreach loop node executor.
 * @description Executes a body workflow once per item (or per slice of items)
 * in the input array, collecting results in order. Supports a configurable
 * `slice` size and cooperative early termination via `core.flow.break` nodes
 * (which throw a {@link GraphBreakSignal}).
 */
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import type { GraphExecutionContext } from "../execution/GraphExecutionContext";
import type { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import type { GraphExecutionValues, GraphLoopMetadata } from "../types";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import { GRAPH_DEFAULT_MAX_FOREACH_ITERATIONS } from "../constants";
import { GraphExecutionEventType } from "../../shared/constants";
import { GraphBreakSignal } from "../errors/GraphBreakSignal";
import { GraphInputError } from "../errors/GraphInputError";
import { GraphLoopLimitError } from "../errors/GraphLoopLimitError";

/**
 * Executor for `core.loop.foreach` nodes.
 *
 * Expects input:
 * - `items`: array of values to iterate over
 * - `slice?`: optional slice size (overrides `metadata.loop.slice`); default `1`
 * - `state?`: optional initial state
 *
 * Produces output:
 * - `results`: array of body outputs (in item order). When `slice > 1`, one
 *   entry per slice (the body receives a slice array on the item port).
 * - `completed`: alias for `results` — the flow after the loop ends (the
 *   collected results array).
 * - `iterations`: number of iterations executed
 * - `broken`: `true` when the loop was terminated early by a Break node
 * - `state?`: final state
 */
export class ForeachGraphNodeExecutor implements GraphNodeExecutor {
  constructor(private readonly engine: GraphExecutionEngine) {}

  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const metadata = this.extractMetadata(context);
    let items = input.items;
    const maxIterations =
      metadata.maxIterations ?? GRAPH_DEFAULT_MAX_FOREACH_ITERATIONS;

    if (!Array.isArray(items)) {
      throw new GraphInputError("foreach input 'items' must be an array");
    }

    const sliceRaw = Number(input.slice ?? metadata.slice ?? 1);
    const slice = Number.isFinite(sliceRaw) && sliceRaw > 0 ? Math.floor(sliceRaw) : 1;
    const iterations = slice > 1 ? Math.ceil(items.length / slice) : items.length;

    if (iterations > maxIterations) {
      throw new GraphLoopLimitError(
        `foreach exceeded max iterations (${iterations} > ${maxIterations})`
      );
    }

    const itemPort = metadata.itemPort ?? "item";
    const resultPort = metadata.resultPort ?? "result";
    const statePort = metadata.statePort ?? "state";
    const bodyWorkflow = metadata.body as GraphWorkflowDefinition;

    const results: unknown[] = [];
    let state = input.state;
    let broken = false;

    await context.emit({ type: GraphExecutionEventType.LOOP_STARTED });

    for (let i = 0; i < iterations; i++) {
      await context.emit({
        type: GraphExecutionEventType.LOOP_ITERATION_STARTED,
        iteration: i,
      });

      const sliceItems = slice > 1 ? items.slice(i * slice, i * slice + slice) : items[i];
      const childInputs: GraphExecutionValues = {
        [itemPort]: sliceItems,
        index: i,
      };
      if (slice > 1) childInputs["slice"] = sliceItems;
      if (state !== undefined) childInputs[statePort] = state;

      try {
        const childResult = await this.engine.execute(
          bodyWorkflow,
          childInputs,
          {
            parentRunId: context.runId,
            path: [...context.path, `iteration:${i}`],
            metadata: { item: sliceItems, index: i, slice },
          }
        );

        results.push(childResult.outputs[resultPort]);
        if (childResult.outputs[statePort] !== undefined) {
          state = childResult.outputs[statePort];
        }
      } catch (err) {
        if (err instanceof GraphBreakSignal) {
          const carried = (err.details as { value?: unknown } | undefined)?.value;
          if (carried !== undefined) results.push(carried);
          broken = true;
          await context.emit({
            type: GraphExecutionEventType.LOOP_ITERATION_COMPLETED,
            iteration: i,
            metadata: { broken: true },
          });
          break;
        }
        throw err;
      }

      await context.emit({
        type: GraphExecutionEventType.LOOP_ITERATION_COMPLETED,
        iteration: i,
      });
    }

    await context.emit({
      type: GraphExecutionEventType.LOOP_COMPLETED,
      metadata: { broken },
    });

    const output: GraphExecutionValues = {
      results,
      completed: results,
      iterations: results.length,
      broken,
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
