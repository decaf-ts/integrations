import { ModelService, service, type Context, type MaybeContextualArg } from "@decaf-ts/core";
import { GraphWorkflowModel } from "./GraphWorkflowModel";

@service(GraphWorkflowModel)
export class GraphWorkflowService extends ModelService<GraphWorkflowModel> {
  constructor() {
    super(GraphWorkflowModel);
  }

  async saveSnapshot(
    workflowId: string,
    snapshot: Record<string, unknown>,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphWorkflowModel> {
    const { ctxArgs } = (await this.logCtx(args, "saveSnapshot", true)).for(this.saveSnapshot);
    const now = new Date();

    let existing: GraphWorkflowModel | null;
    try {
      existing = (await this.read(workflowId, ...ctxArgs)) as GraphWorkflowModel | null;
    } catch {
      existing = null;
    }

    if (existing) {
      existing.snapshot = snapshot;
      existing.updatedAt = now;
      return this.update(existing, ...ctxArgs);
    }

    const model = new GraphWorkflowModel({
      workflowId,
      snapshot,
      updatedAt: now,
    });
    return this.create(model, ...ctxArgs);
  }

  async loadSnapshot(
    workflowId: string,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphWorkflowModel | null> {
    const { ctxArgs } = (await this.logCtx(args, "loadSnapshot", true)).for(this.loadSnapshot);
    try {
      return (await this.read(workflowId, ...ctxArgs)) as GraphWorkflowModel | null;
    } catch {
      return null;
    }
  }
}
