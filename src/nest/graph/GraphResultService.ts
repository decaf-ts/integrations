import { ModelService, service, type Context, type MaybeContextualArg } from "@decaf-ts/core";
import { GraphExecutionResultModel } from "./GraphExecutionResultModel";
import type { GraphExecutionResult } from "../../graph";
import { graphWorkflowOwnerOf } from "./GraphWorkflowService";

/**
 * Model-backed persistence for {@link GraphExecutionResultModel} rows: the
 * terminal snapshot the (deprecated) synchronous `POST /graph/execute`
 * surface persists after a run completes. Access control lives at the
 * controller/route layer, which gates reads through the run ownership check.
 */
@service(GraphExecutionResultModel)
export class GraphResultService extends ModelService<GraphExecutionResultModel> {
  constructor() {
    super(GraphExecutionResultModel);
  }

  /**
   * Persists a finished run's result, stamping the owning user resolved
   * from the request context onto the `owner` column (SAA-595 F1); results
   * saved without a resolved identity carry no owner.
   */
  async saveResult(
    result: GraphExecutionResult,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphExecutionResultModel> {
    const { ctx, ctxArgs } = (await this.logCtx(args, "saveResult", true)).for(this.saveResult);
    const owner = graphWorkflowOwnerOf(ctx);
    const model = new GraphExecutionResultModel({
      runId: result.runId,
      workflowId: result.workflowId,
      ...(owner ? { owner } : {}),
      status: result.status,
      inputs: result.inputs,
      outputs: result.outputs,
      nodeResults: result.nodeResults as Record<string, unknown>,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    });
    return this.create(model, ...ctxArgs);
  }

  /** Reads a result row by run id; returns `null` when no result was persisted (never throws). */
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
