import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  Sse,
  MessageEvent,
  Optional,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { map } from "rxjs/operators";

import {
  GraphExecutionEngine,
  type GraphExecutionEvent,
  type GraphExecutionValues,
} from "../../graph";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";
import { DecafRequestContext } from "@decaf-ts/for-nest";

import { GraphResultService } from "./GraphResultService";
import { GraphWorkflowService } from "./GraphWorkflowService";

export interface GraphExecutePayload {
  workflow: GraphWorkflowDefinition;
  inputs: GraphExecutionValues;
}

export interface GraphExecuteResponse {
  runId: string;
  status: string;
  outputs: Record<string, unknown>;
}

@Controller("graph")
export class GraphExecutionController {
  private readonly eventSubject = new Subject<GraphExecutionEvent>();

  constructor(
    private readonly engine: GraphExecutionEngine,
    private readonly resultService: GraphResultService,
    private readonly workflowService: GraphWorkflowService,
    @Optional() @Inject(DecafRequestContext) private readonly requestContext?: DecafRequestContext,
  ) {
    this.engine.observe({
      refresh: async (event) => {
        this.eventSubject.next(event);
      },
    });
  }

  @Post("execute")
  async execute(
    @Body() body: GraphExecutePayload
  ): Promise<GraphExecuteResponse> {
    const result = await this.engine.execute(body.workflow, body.inputs ?? {});

    try {
      await this.resultService.saveResult(result, this.requestContext);
    } catch {
      // persistence failures must not mask a successful execution result
    }

    return {
      runId: result.runId,
      status: result.status,
      outputs: result.outputs,
    };
  }

  @Sse("events")
  events(): Observable<MessageEvent> {
    return this.eventSubject.asObservable().pipe(
      map(
        (event: GraphExecutionEvent): MessageEvent => ({
          type: "message",
          data: JSON.stringify([
            "graph",
            event.type,
            event.runId,
            {
              id: event.id,
              sequence: event.sequence,
              type: event.type,
              runId: event.runId,
              parentRunId: event.parentRunId,
              workflowId: event.workflowId,
              nodeId: event.nodeId,
              edgeId: event.edgeId,
              port: event.port,
              iteration: event.iteration,
              path: event.path,
              status: event.status,
              payload: event.payload,
              error: event.error,
              timestamp: event.timestamp.toISOString(),
            },
          ]),
        })
      )
    );
  }

  @Get("results/:runId")
  async getResult(@Param("runId") runId: string): Promise<unknown> {
    const model = await this.resultService.findByRunId(runId, this.requestContext);
    if (!model) {
      throw new NotFoundException(
        `No graph execution result found for runId '${runId}'`
      );
    }
    return {
      runId: model.runId,
      workflowId: model.workflowId,
      status: model.status,
      inputs: model.inputs,
      outputs: model.outputs,
      nodeResults: model.nodeResults,
      startedAt: model.startedAt,
      finishedAt: model.finishedAt,
    };
  }

  @Put("workflow/:id")
  async saveWorkflow(
    @Param("id") id: string,
    @Body() snapshot: Record<string, unknown>
  ): Promise<{ workflowId: string; savedAt: string }> {
    const model = await this.workflowService.saveSnapshot(id, snapshot, this.requestContext);
    return { workflowId: id, savedAt: model.updatedAt.toISOString() };
  }
}
