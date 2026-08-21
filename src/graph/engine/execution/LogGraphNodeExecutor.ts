/**
 * @module integrations/graph/execution/LogGraphNodeExecutor
 * @summary Executor for the Log flow-control / utility node.
 * @description Logs the input value via the execution context's logger
 * (`context.logger`) at a configurable level and forwards it unchanged on the
 * `logged` output port (DECAF-48 §4.3). Because it shares the run's
 * `ctx.logger`, the log line carries the standard `nodeId` / `workflowId` /
 * `runId` / `user` attributes and streams over the same `graph.run.log` SSE
 * channel — no parallel logging path (DECAF-48 Req-1).
 */
import type { StringLike, LogMeta } from "@decaf-ts/logging";

import type { GraphNodeExecutor } from "./GraphNodeExecutor";
import type { GraphExecutionContext } from "./GraphExecutionContext";
import type { GraphExecutionValues } from "../types";
import type { LogNodeLevel } from "../../shared/types";

/**
 * Resolves the log level for a Log node execution.
 *
 * The level is read from the node's UI config (`node.props.level`) so authors
 * can pin a level per instance via the canvas; defaults to `info` when unset.
 */
function logLevelOf(context: GraphExecutionContext): LogNodeLevel {
  const candidate = (context.node.props ?? {}).level as string | undefined;
  return (candidate as LogNodeLevel) || "info";
}

/**
 * Executor for `core.utility.log` / `core.flow.log` nodes.
 *
 * Reads the `value` input port, logs it through `context.logger` at the
 * configured level, and returns it unchanged on the `logged` output port.
 */
export class LogGraphNodeExecutor implements GraphNodeExecutor {
  /**
   * Logs the `value` input through the run's `ctx.logger` and forwards it
   * unchanged on the `logged` output port.
   *
   * The level is read from the node's UI config (`node.props.level`, see
   * {@link logLevelOf}) and defaults to `info`. The emitted log line carries
   * the DECAF-48 run attributes and streams over `graph.run.log` through the
   * shared `ctx.logger` path (DECAF-48 Req-1).
   *
   * @param input - Resolved input values keyed by port name (expects `value`).
   * @param context - The run-scoped execution context exposing `ctx.logger`.
   * @returns The node's output values keyed by port name (the `logged` port).
   */
  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const value = input["value"];
    const level = logLevelOf(context);
    const logger = context.logger as unknown as Record<
      LogNodeLevel,
      (msg: StringLike, meta?: LogMeta) => void
    >;
    logger[level]("Log node", { value });
    return { logged: value };
  }
}
