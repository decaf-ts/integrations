/**
 * @module integrations/graph/execution/GraphExecutionContext
 * @summary Decaf Context for graph node execution.
 * @description Extends Decaf's {@link Context} so node executors receive the same contextual plumbing as task handlers. Executors use the context to emit progress, log messages, and report state through the engine's observer pipeline. Each context also exposes a run-scoped `ctx.logger` (DECAF-48 §4.3) bound to the executing node's `runId` / `workflowId` / `nodeId` / `user`, so every log line streams over `graph.run.log` with the DECAF-9 custom attributes.
 */
import { Context } from "@decaf-ts/core";
import type {
  GraphNodeDefinition,
  GraphWorkflowDefinition,
} from "@decaf-ts/ui-decorators/graph";
import type { Logger } from "@decaf-ts/logging";

import { GraphExecutionEventType } from "../../shared/constants";
import { GraphRunLogger } from "../../log/GraphRunLogger";
import type {
  GraphExecutionEvent,
  GraphRunId,
} from "../types";

/**
 * Context passed to every graph node executor.
 *
 * Mirrors the `TaskEngine` / `TaskContext` pattern: the engine creates a
 * `GraphExecutionContext` per node execution and passes it to
 * `executor.execute(inputs, context)`. The executor uses `context.progress(...)`
 * and `context.log(...)` to report intermediate state, and `context.logger`
 * to emit structured run log lines (DECAF-48 §4.3).
 */
export class GraphExecutionContext extends Context {
  private readonly runLogger?: GraphRunLogger;

  /**
   * @param runId - Unique identifier for the current execution run.
   * @param parentRunId - Run id of the parent execution (for nested loop bodies).
   * @param workflow - The workflow definition being executed.
   * @param node - The node definition being executed.
   * @param path - Dotted path from the workflow root to this node.
   * @param emitFn - Callback invoked when an event is emitted from this context.
   * @param metadata - Free-form metadata attached to this context.
   */
  constructor(
    readonly runId: GraphRunId,
    readonly parentRunId: GraphRunId | undefined,
    readonly workflow: GraphWorkflowDefinition,
    readonly node: GraphNodeDefinition,
    readonly path: string[],
    private readonly emitFn: (event: Partial<GraphExecutionEvent>) => Promise<void>,
    readonly metadata: Record<string, unknown> = {}
  ) {
    super();
    const user = typeof metadata?.["user"] === "string" ? metadata["user"] : null;
    this.runLogger = new GraphRunLogger({
      runId,
      workflowId: workflow.name,
      nodeId: node.name,
      user,
      forward: async (event) => {
        await this.emit(event);
      },
    });
  }

  /**
   * The decaf-ts {@link Logger} bound to this node's run context. Every log
   * line carries the DECAF-48 attributes (`nodeId` / `workflowId` / `runId` /
   * `user`) and is forwarded onto the existing graph execution Observable as
   * a `GRAPH_RUN_LOG` event (streamed over the `graph.run.log` SSE channel).
   */
  get logger(): Logger {
    return this.runLogger!;
  }

  /**
   * Emits a partial graph execution event. The engine fills in runId,
   * parentRunId, workflowId, nodeId, and path automatically.
   */
  async emit(event: Partial<GraphExecutionEvent>): Promise<void> {
    await this.emitFn({
      ...event,
      runId: this.runId,
      parentRunId: this.parentRunId,
      workflowId: this.workflow.name,
      nodeId: this.node.name,
      path: event.path ?? this.path,
    });
  }

  /**
   * Emits a `NODE_OUTPUT` event with the given payload, useful for reporting
   * intermediate progress from within a node executor.
   */
  async progress(payload: unknown): Promise<void> {
    await this.emit({
      type: GraphExecutionEventType.NODE_OUTPUT,
      payload,
    });
  }

  /**
   * Emits a `NODE_OUTPUT` event with a structured `{ message, payload }` shape
   * so executors can log human-readable messages.
   */
  async log(message: string, payload?: unknown): Promise<void> {
    await this.emit({
      type: GraphExecutionEventType.NODE_OUTPUT,
      payload: {
        message,
        payload,
      },
    });
  }
}
