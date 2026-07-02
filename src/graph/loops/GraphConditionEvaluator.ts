/**
 * @module integrations/graph/loops/GraphConditionEvaluator
 * @summary Evaluator for built-in loop condition types.
 * @description Supports safe, built-in condition types only. Does NOT evaluate arbitrary JavaScript expressions.
 */
import type { GraphConditionDefinition } from "../types";
import { GraphConditionType } from "../constants";
import { GraphExecutionError } from "../errors/GraphExecutionError";

/**
 * Evaluates loop conditions using built-in comparison types.
 */
export class GraphConditionEvaluator {
  /**
   * Evaluates a condition against the given state.
   *
   * @param condition - The condition definition.
   * @param state - The current loop state.
   * @returns `true` when the condition passes.
   */
  evaluate(condition: GraphConditionDefinition, state: unknown): boolean {
    const left = this.resolveValue(condition.left, state);
    const right = condition.right;

    switch (condition.type) {
      case GraphConditionType.TRUTHY:
        return !!left;
      case GraphConditionType.FALSY:
        return !left;
      case GraphConditionType.EQUALS:
        return left === right;
      case GraphConditionType.NOT_EQUALS:
        return left !== right;
      case GraphConditionType.GREATER_THAN:
        return Number(left) > Number(right);
      case GraphConditionType.GREATER_THAN_OR_EQUAL:
        return Number(left) >= Number(right);
      case GraphConditionType.LESS_THAN:
        return Number(left) < Number(right);
      case GraphConditionType.LESS_THAN_OR_EQUAL:
        return Number(left) <= Number(right);
      case GraphConditionType.EXISTS:
        return left !== undefined && left !== null;
      case GraphConditionType.CUSTOM:
        throw new GraphExecutionError(
          "Custom condition evaluators are not supported in v1",
          "GRAPH_CUSTOM_CONDITION_UNSUPPORTED"
        );
      default:
        throw new GraphExecutionError(
          `Unknown condition type '${condition.type}'`,
          "GRAPH_UNKNOWN_CONDITION_TYPE",
          { condition }
        );
    }
  }

  /**
   * Resolves a value that may be a dotted path into the state object.
   */
  private resolveValue(path: string | undefined, state: unknown): unknown {
    if (!path) return state;
    const parts = path.split(".");
    let current: unknown = state;
    for (const part of parts) {
      if (current == null) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
