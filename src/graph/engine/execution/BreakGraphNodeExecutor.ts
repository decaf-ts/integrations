/**
 * @module integrations/graph/execution/BreakGraphNodeExecutor
 * @summary Executor for the Break flow-control node.
 * @description Throws a {@link GraphBreakSignal} that the enclosing loop
 * executor catches to terminate the loop early. The optional `value` input is
 * carried on the signal so the loop can append it as the last partial result.
 */
import type { GraphNodeExecutor } from "./GraphNodeExecutor";
import type { GraphExecutionContext } from "./GraphExecutionContext";
import type { GraphExecutionValues } from "../types";
import { GraphBreakSignal } from "../errors/GraphBreakSignal";

/**
 * Executor for `core.flow.break` nodes.
 *
 * Reads the optional `value` input port and throws a {@link GraphBreakSignal}
 * carrying it. The enclosing loop executor (`core.loop.foreach`,
 * `core.loop.while`, `core.loop.until`) catches the signal, stops iterating,
 * and returns the results collected so far (plus the carried value as the
 * final partial result).
 */
export class BreakGraphNodeExecutor implements GraphNodeExecutor {
  async execute(
    input: GraphExecutionValues,
    _context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const value = input["value"];
    throw new GraphBreakSignal(value);
  }
}
