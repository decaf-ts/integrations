import { ModelService, service, type Context, type MaybeContextualArg } from "@decaf-ts/core";
import { GraphExecutionResultModel } from "./GraphExecutionResultModel";
import type { GraphExecutionResult } from "../../graph";

@service(GraphExecutionResultModel)
export class GraphResultService extends ModelService<GraphExecutionResultModel> {
  constructor() {
    super(GraphExecutionResultModel);
  }

  async saveResult(
    result: GraphExecutionResult,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphExecutionResultModel> {
    const { ctxArgs } = (await this.logCtx(args, "saveResult", true)).for(this.saveResult);
    const model = new GraphExecutionResultModel({
      runId: result.runId,
      workflowId: result.workflowId,
      status: result.status,
      inputs: result.inputs,
      outputs: result.outputs,
      nodeResults: result.nodeResults as Record<string, unknown>,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    });
    return this.create(model, ...ctxArgs);
  }

  async findByRunId(
    runId: string,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphExecutionResultModel | null> {
    const { ctxArgs } = (await this.logCtx(args, "findByRunId", true)).for(this.findByRunId);
    try {
      return (await this.read(runId, ...ctxArgs)) as GraphExecutionResultModel;
    } catch {
      return null;
    }
  }
}
