/**
 * @module integrations/graph/execution/LogGraphNodeExecutor
 * @summary Executor for the Log flow-control node.
 * @description Logs the input value via the execution context's logger and
 * forwards it unchanged on the `logged` output port. Useful for debugging,
 * audit trails, and discard/side-effect branches in a workflow.
 */
import type { GraphNodeExecutor } from "./GraphNodeExecutor";
import type { GraphExecutionContext } from "./GraphExecutionContext";
import type { GraphExecutionValues } from "../types";

/**
 * Executor for `core.flow.log` nodes.
 *
 * Reads the `value` input port, logs it through `context.log()`, and returns
 * it unchanged on the `logged` output port.
 */
export class LogGraphNodeExecutor implements GraphNodeExecutor {
  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const value = input["value"];
    await context.log("Log node", { value });
    return { logged: value };
  }
}
