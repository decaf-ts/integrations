/**
 * @module integrations/graph/execution/SwitchGraphNodeExecutor
 * @summary Executor for the Switch flow-control node (DECAF-32 §22.2.2).
 * @description Evaluates each case's condition against the node's input and
 * routes the input to the first matching case's output port. Falls back to
 * the `default` output when no case matches. Supports both
 * {@link ConditionExpression} (graphical mode) and {@link CodeCondition}
 * (code mode via the pluggable {@link CodeSandboxEvaluator}).
 */
import type { GraphNodeExecutor } from "./GraphNodeExecutor";
import type { GraphExecutionContext } from "./GraphExecutionContext";
import type {
  GraphExecutionValues,
  SwitchCaseCondition,
  SwitchNodeMetadata,
  ConditionExpression,
  CodeCondition,
} from "../types";
import { GraphExecutionError } from "../errors/GraphExecutionError";
import { ConditionExpressionEvaluator } from "../loops/ConditionExpressionEvaluator";
import type { CodeSandboxEvaluator } from "./CodeSandboxEvaluator";

/**
 * Reads the Switch metadata from the node definition's graph metadata.
 */
function readSwitchMetadata(
  context: GraphExecutionContext
): SwitchNodeMetadata {
  const meta = context.node.graph?.metadata as
    | Record<string, unknown>
    | undefined;
  if (!meta) return { cases: [], defaultPort: "default" };
  const switchMeta = meta["switch"] as SwitchNodeMetadata | undefined;
  if (!switchMeta || !Array.isArray(switchMeta.cases)) {
    return { cases: [], defaultPort: "default" };
  }
  return {
    cases: switchMeta.cases,
    defaultPort: switchMeta.defaultPort ?? "default",
  };
}

/**
 * Detects whether a condition is a `CodeCondition` (has `type: "code"`).
 */
function isCodeCondition(cond: SwitchCaseCondition): cond is CodeCondition {
  return (
    typeof cond === "object" &&
    cond !== null &&
    "type" in cond &&
    cond.type === "code"
  );
}

/**
 * Detects whether a condition is a `ConditionExpression` (has `op` field).
 */
function isConditionExpression(
  cond: SwitchCaseCondition
): cond is ConditionExpression {
  return (
    typeof cond === "object" &&
    cond !== null &&
    "op" in cond &&
    typeof cond.op === "string"
  );
}

/**
 * Executor for `core.flow.switch` nodes.
 *
 * Evaluates each case's condition in order and routes the input to the
 * first matching case's output port. When no case matches, routes to the
 * `default` output port.
 *
 * Condition evaluation:
 * - `ConditionExpression` — evaluated via {@link ConditionExpressionEvaluator}.
 * - `CodeCondition` — evaluated via the pluggable {@link CodeSandboxEvaluator}
 *   from the engine's config. Throws `GRAPH_CODE_SANDBOX_NOT_CONFIGURED`
 *   when no evaluator is registered.
 */
export class SwitchGraphNodeExecutor implements GraphNodeExecutor {
  private readonly expressionEvaluator = new ConditionExpressionEvaluator();

  constructor(
    private readonly engine?: { codeSandboxEvaluator?: CodeSandboxEvaluator }
  ) {}

  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const meta = readSwitchMetadata(context);
    const inputValue = input["value"] ?? input;

    for (const switchCase of meta.cases) {
      const matches = await this.evaluateCondition(
        switchCase.condition,
        inputValue,
        input,
        context
      );
      if (matches) {
        return { [switchCase.outputPort]: inputValue };
      }
    }

    const defaultPort = meta.defaultPort ?? "default";
    return { [defaultPort]: inputValue };
  }

  /**
   * Evaluates a single switch case condition.
   */
  private async evaluateCondition(
    condition: SwitchCaseCondition,
    inputValue: unknown,
    fullInput: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<boolean> {
    if (isCodeCondition(condition)) {
      return this.evaluateCodeCondition(condition, fullInput, context);
    }

    if (isConditionExpression(condition)) {
      return this.expressionEvaluator.evaluate(condition, inputValue);
    }

    throw new GraphExecutionError(
      "Unknown switch case condition type — must be ConditionExpression (op) or CodeCondition (type: 'code')",
      "GRAPH_UNKNOWN_SWITCH_CONDITION",
      { condition }
    );
  }

  /**
   * Evaluates a code condition via the pluggable sandbox evaluator.
   */
  private async evaluateCodeCondition(
    condition: CodeCondition,
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<boolean> {
    const evaluator = this.engine?.codeSandboxEvaluator;
    if (!evaluator) {
      throw new GraphExecutionError(
        "Code conditions require a CodeSandboxEvaluator to be registered in GraphExecutionEngineConfig.codeSandboxEvaluator",
        "GRAPH_CODE_SANDBOX_NOT_CONFIGURED",
        { code: condition.code }
      );
    }

    await context.log(`Evaluating code condition`, {
      language: condition.language ?? "javascript",
    });

    const result = await evaluator.evaluate({
      code: condition.code,
      language: condition.language,
      input,
    });

    return !!result;
  }
}
