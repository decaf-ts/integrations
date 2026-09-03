import { model } from "@decaf-ts/decorator-validation";
import { BaseModel, column, pk, table } from "@decaf-ts/core";

/**
 * Persisted terminal snapshot of one graph run (written by
 * {@link GraphResultService} after the deprecated synchronous execute
 * endpoint completes). Keyed by `runId`; the optional `owner` column (added
 * by SAA-595 F1) records the run's owning user so result reads can be
 * ownership-gated at the route layer.
 */
@table("graph_execution_result")
@model()
export class GraphExecutionResultModel extends BaseModel {
  @pk({ type: String, generated: false })
  runId!: string;

  @column()
  workflowId!: string;

  /**
   * Owning user of the run this result belongs to (SAA-595 F1); absent for
   * legacy/anonymous results, which carry no enforceable ownership.
   */
  @column()
  owner?: string;

  @column()
  status!: string;

  @column()
  inputs!: Record<string, unknown>;

  @column()
  outputs!: Record<string, unknown>;

  @column()
  nodeResults!: Record<string, unknown>;

  @column()
  startedAt!: Date;

  @column()
  finishedAt?: Date;

  constructor(arg?: Partial<GraphExecutionResultModel>) {
    super(arg);
  }
}
