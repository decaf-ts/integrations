/**
 * @module integrations/graph/registry/GraphNodeExecutorRegistry
 * @summary Registry for graph node executors.
 * @description Maps node kinds to their executor implementations. The engine resolves executors by node kind at execution time.
 */
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import { GraphExecutionError } from "../errors/GraphExecutionError";

/**
 * Registry that maps node `kind` strings to {@link GraphNodeExecutor}
 * instances.
 */
export class GraphNodeExecutorRegistry {
  private readonly executors = new Map<string, GraphNodeExecutor>();

  /** Registers an executor for the given node kind. */
  register(kind: string, executor: GraphNodeExecutor): this {
    if (!kind) throw new GraphExecutionError("Graph executor kind is required");
    this.executors.set(kind, executor);
    return this;
  }

  /** Removes the executor for the given node kind. */
  unregister(kind: string): this {
    this.executors.delete(kind);
    return this;
  }

  /** Returns whether an executor is registered for the given kind. */
  has(kind: string): boolean {
    return this.executors.has(kind);
  }

  /**
   * Resolves the executor for the given node kind.
   *
   * @throws {GraphExecutionError} when no executor is registered for `kind`.
   */
  resolve(kind: string): GraphNodeExecutor {
    const executor = this.executors.get(kind);
    if (!executor) {
      throw new GraphExecutionError(
        `No graph executor registered for kind '${kind}'`,
        "GRAPH_EXECUTOR_NOT_FOUND",
        { kind }
      );
    }
    return executor;
  }
}
