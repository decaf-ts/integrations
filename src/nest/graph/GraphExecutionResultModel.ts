import { Model, model, type ModelArg } from "@decaf-ts/decorator-validation";
import { column, pk, table } from "@decaf-ts/core";

@table("graph_execution_result")
@model()
export class GraphExecutionResultModel extends Model {
  @pk({ type: String, generated: false })
  runId!: string;

  @column()
  workflowId!: string;

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

  constructor(arg?: ModelArg<GraphExecutionResultModel>) {
    super(arg);
  }
}
