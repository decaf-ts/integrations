import { model } from "@decaf-ts/decorator-validation";
import { BaseModel, column, pk, table } from "@decaf-ts/core";

@table("graph_workflow_snapshot")
@model()
export class GraphWorkflowModel extends BaseModel {
  @pk({ type: String, generated: false })
  workflowId!: string;

  @column()
  snapshot!: Record<string, unknown>;

  constructor(arg?: Partial<GraphWorkflowModel>) {
    super(arg);
  }
}
