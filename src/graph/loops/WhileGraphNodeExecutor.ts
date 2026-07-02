/**
 * @module integrations/graph/loops/WhileGraphNodeExecutor
 * @summary While loop node executor.
 * @description Executes a body workflow repeatedly while a condition is true, enforcing a maximum iteration limit.
 */
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import type { GraphExecutionContext } from "../execution/GraphExecutionContext";
import type { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import type { GraphExecutionValues, GraphLoopMetadata } from "../types";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import { GRAPH_DEFAULT_MAX_LOOP_ITERATIONS, GraphExecutionEventType } from "../constants";
import { GraphInputError } from "../errors/GraphInputError";
import { GraphLoopLimitError } from "../errors/GraphLoopLimitError";
import { GraphConditionEvaluator } from "./GraphConditionEvaluator";

/**
 * Executor for `core.loop.while` nodes.
 *
 * Expects input:
 * - `state`: initial state
 *
 * Produces output:
 * - `state`: final state
 * - `iterations`: number of iterations executed
 */
export class WhileGraphNodeExecutor implements GraphNodeExecutor {
  private readonly evaluator = new GraphConditionEvaluator();

  constructor(private readonly engine: GraphExecutionEngine) {}

  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const metadata = this.extractMetadata(context);
    const maxIterations =
      metadata.maxIterations ?? GRAPH_DEFAULT_MAX_LOOP_ITERATIONS;
    const condition = metadata.condition;
    if (!condition) {
      throw new GraphInputError("while node is missing a condition");
    }
    const statePort = metadata.statePort ?? "state";
    const bodyWorkflow = metadata.body as GraphWorkflowDefinition;

    let state = input.state;
    let iteration = 0;

    await context.emit({ type: GraphExecutionEventType.LOOP_STARTED });

    while (this.evaluator.evaluate(condition, state)) {
      if (iteration >= maxIterations) {
        await context.emit({
          type: GraphExecutionEventType.LOOP_LIMIT_REACHED,
          iteration,
        });
        throw new GraphLoopLimitError(
          `while loop exceeded max iterations (${maxIterations})`
        );
      }

      await context.emit({
        type: GraphExecutionEventType.LOOP_CONDITION_EVALUATED,
        iteration,
        payload: { result: true },
      });
      await context.emit({
        type: GraphExecutionEventType.LOOP_ITERATION_STARTED,
        iteration,
      });

      const childResult = await this.engine.execute(
        bodyWorkflow,
        { [statePort]: state, iteration },
        {
          parentRunId: context.runId,
          path: [...context.path, `iteration:${iteration}`],
        }
      );

      state = childResult.outputs[statePort];

      await context.emit({
        type: GraphExecutionEventType.LOOP_ITERATION_COMPLETED,
        iteration,
      });

      iteration++;
    }

    await context.emit({ type: GraphExecutionEventType.LOOP_COMPLETED });

    return { [statePort]: state, iterations: iteration };
  }

  private extractMetadata(context: GraphExecutionContext): GraphLoopMetadata {
    const raw = (context.node as any).graph?.metadata?.loop ??
      (context.metadata as any)?.loop;
    if (!raw) {
      throw new GraphInputError("while node is missing loop metadata");
    }
    return raw as GraphLoopMetadata;
  }
}
