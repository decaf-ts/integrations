/**
 * @module integrations/graph/loops/UntilGraphNodeExecutor
 * @summary Until loop node executor.
 * @description Executes a body workflow at least once and repeats until a condition is true.
 */
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import type { GraphExecutionContext } from "../execution/GraphExecutionContext";
import type { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import type { GraphExecutionValues, GraphLoopMetadata } from "../types";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import { GRAPH_DEFAULT_MAX_LOOP_ITERATIONS } from "../constants";
import { GraphExecutionEventType } from "../../shared/constants";
import { GraphInputError } from "../errors/GraphInputError";
import { GraphLoopLimitError } from "../errors/GraphLoopLimitError";
import { GraphConditionEvaluator } from "./GraphConditionEvaluator";

/**
 * Executor for `core.loop.until` nodes.
 *
 * Executes the body at least once, then checks the condition. Repeats until
 * the condition evaluates to true.
 */
export class UntilGraphNodeExecutor implements GraphNodeExecutor {
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
      throw new GraphInputError("until node is missing a condition");
    }
    const statePort = metadata.statePort ?? "state";
    const bodyWorkflow = metadata.body as GraphWorkflowDefinition;

    let state = input.state;
    let iteration = 0;

    await context.emit({ type: GraphExecutionEventType.LOOP_STARTED });

    let shouldStop = false;

    do {
      if (iteration >= maxIterations) {
        await context.emit({
          type: GraphExecutionEventType.LOOP_LIMIT_REACHED,
          iteration,
        });
        throw new GraphLoopLimitError(
          `until loop exceeded max iterations (${maxIterations})`
        );
      }

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

      const conditionResult = this.evaluator.evaluate(condition, state);

      await context.emit({
        type: GraphExecutionEventType.LOOP_CONDITION_EVALUATED,
        iteration,
        payload: { result: conditionResult },
      });

      iteration++;
      shouldStop = conditionResult;
    } while (!shouldStop);

    await context.emit({ type: GraphExecutionEventType.LOOP_COMPLETED });

    return { [statePort]: state, iterations: iteration };
  }

  private extractMetadata(context: GraphExecutionContext): GraphLoopMetadata {
    const raw = (context.node as any).graph?.metadata?.loop ??
      (context.metadata as any)?.loop;
    if (!raw) {
      throw new GraphInputError("until node is missing loop metadata");
    }
    return raw as GraphLoopMetadata;
  }
}
