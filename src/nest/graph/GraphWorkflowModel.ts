import { Model, model, type ModelArg } from "@decaf-ts/decorator-validation";
import { column, pk, table } from "@decaf-ts/core";

@table("graph_workflow_snapshot")
@model()
export class GraphWorkflowModel extends Model {
  @pk({ type: String, generated: false })
  workflowId!: string;

  @column()
  snapshot!: Record<string, unknown>;

  @column()
  updatedAt!: Date;

  constructor(arg?: ModelArg<GraphWorkflowModel>) {
    super(arg);
  }
}
