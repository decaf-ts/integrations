/**
 * @module integrations/graph/loops/UntilGraphNodeExecutor
 * @summary Until loop node executor.
 * @description Executes a body workflow at least once and repeats until a condition is true.
 */
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import type { GraphExecutionContext } from "../execution/GraphExecutionContext";
import type { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import type {
  GraphExecutionValues,
  GraphLoopMetadata,
  GraphNodeExecutionRequest,
} from "../types";

import { GRAPH_DEFAULT_MAX_LOOP_ITERATIONS } from "../constants";
import { GraphExecutionEventType } from "@decaf-ts/ui-decorators/graph";
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
    request: GraphNodeExecutionRequest,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const metadata = this.extractMetadata(context);
    const input = request.inputs;
    const maxIterations =
      metadata.maxIterations ?? GRAPH_DEFAULT_MAX_LOOP_ITERATIONS;
    const condition = metadata.condition;
    if (!condition) {
      throw new GraphInputError("until node is missing a condition");
    }
    const statePort = metadata.statePort ?? "state";
    const bodyWorkflow = metadata.body;

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
    const instance = context.node;
    const parameters = (instance.parameters ?? {}) as Record<string, unknown>;
    const loop = instance.loop;
    const fallback = (context.metadata as Record<string, unknown> | undefined)?.["loop"] as
      | Record<string, unknown>
      | undefined;
    if (!loop?.body && !fallback?.["body"]) {
      throw new GraphInputError("until node is missing loop configuration (instance.loop.body)");
    }
    const body = (loop?.body ?? fallback?.["body"]) as GraphLoopMetadata["body"];
    const number = (key: string): number | undefined => {
      const raw = parameters[key] ?? loop?.[key as "maxIterations" | "timeoutMs" | "concurrency"] ?? fallback?.[key];
      const value = Number(raw);
      return raw !== undefined && Number.isFinite(value) ? value : undefined;
    };
    const string = (key: string): string | undefined => {
      const raw = parameters[key] ?? fallback?.[key];
      return typeof raw === "string" ? raw : undefined;
    };
    return {
      body,
      maxIterations: number("maxIterations"),
      timeoutMs: number("timeoutMs"),
      concurrency: number("concurrency"),
      condition: (parameters["condition"] ?? fallback?.["condition"]) as
        | GraphLoopMetadata["condition"]
        | undefined,
      inputPort: string("inputPort"),
      outputPort: string("outputPort"),
      itemPort: string("itemPort"),
      resultPort: string("resultPort"),
      statePort: string("statePort"),
      slice: number("slice"),
    };
  }
}
