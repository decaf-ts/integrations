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
  GraphRunService,
  type GraphExecutionEvent,
  type GraphExecutionValues,
} from "../../graph";
import {
  isGraphWorkflowDocumentShape,
  type GraphWorkflowDocument,
} from "@decaf-ts/ui-decorators/graph";
import { ValidationError } from "@decaf-ts/db-decorators";
import { DecafRequestContext } from "@decaf-ts/for-nest";

import { GraphResultService } from "./GraphResultService";
import { GraphWorkflowService, graphWorkflowOwnerOf } from "./GraphWorkflowService";

/**
 * Execution payloads accept a canonical {@link GraphWorkflowDocument} only
 * (DECAF-50 §4.16 cutover): client payloads carrying legacy definitions,
 * snapshots, or inline node/definition/executor/ports/component fields are
 * rejected at the boundary.
 */
export interface GraphExecutePayload {
  workflow: GraphWorkflowDocument;
  inputs: GraphExecutionValues;
}

/** Response of the (deprecated) synchronous execute endpoint: run id, terminal status, and output values. */
export interface GraphExecuteResponse {
  runId: string;
  status: string;
  outputs: Record<string, unknown>;
}

/**
 * Legacy synchronous graph execution surface (DECAF-50 §4.14/§4.18): the
 * `POST /graph/execute` endpoint (deprecated in favour of the run lifecycle
 * at `POST /graph/runs`), the legacy `PUT /graph/:id/execute` alias, and the
 * deprecated global SSE event stream. All execution now flows through
 * {@link GraphRunService}; only canonical documents are accepted.
 */
@Controller("graph")
export class GraphExecutionController {
  private readonly eventSubject = new Subject<GraphExecutionEvent>();

  constructor(
    private readonly engine: GraphExecutionEngine,
    private readonly resultService: GraphResultService,
    private readonly workflowService: GraphWorkflowService,
    private readonly runService: GraphRunService,
    @Optional() @Inject(DecafRequestContext) private readonly requestContext?: DecafRequestContext,
  ) {
    this.engine.observe({
      refresh: async (event) => {
        this.eventSubject.next(event);
      },
    });
  }

  /**
   * @deprecated DECAF-50 §4.14/§4.18 cutover: the synchronous execution
   * endpoint is deprecated in favour of the asynchronous run lifecycle
   * (`POST /graph/runs`). It is kept, not removed, within this
   * specification. Only canonical {@link GraphWorkflowDocument} payloads are
   * accepted; legacy definition/snapshot payloads and inline
   * node/definition/executor/ports/component fields are rejected (§4.16).
   */
  @Post("execute")
  async execute(
    @Body() body: GraphExecutePayload
  ): Promise<GraphExecuteResponse> {
    const document = this.requireCanonicalDocument(body.workflow);
    const run = await this.runService.executeAndWait(
      { workflow: document, inputs: body.inputs ?? {} },
      graphWorkflowOwnerOf(this.requestContext) ?? null,
      this.requestContext
    );

    if (run.result) {
      try {
        await this.resultService.saveResult(run.result, this.requestContext);
      } catch {
        // persistence failures must not mask a successful execution result
      }
    }

    return {
      runId: run.runId,
      status: run.status,
      outputs: (run.result?.outputs ?? {}) as Record<string, unknown>,
    };
  }

  /**
   * DECAF-50 §4.16 cutover: only a canonical {@link GraphWorkflowDocument}
   * is accepted. Payloads resembling legacy decorated definitions, snapshot
   * wrappers, or any other non-canonical shape are rejected with a Decaf
   * {@link ValidationError} before the engine or planner sees them.
   */
  private requireCanonicalDocument(
    workflow: GraphWorkflowDocument
  ): GraphWorkflowDocument {
    if (isGraphWorkflowDocumentShape(workflow)) {
      return workflow;
    }
    throw new ValidationError(
      "Execution payload must be a canonical GraphWorkflowDocument: legacy workflow definitions, snapshot wrappers and inline node/definition/executor/ports/component payloads are rejected; compile decorated workflows client-side via GraphDecoratedWorkflowCompiler or use POST /graph/runs"
    );
  }

  /**
   * @deprecated DECAF-50 §4.15 cutover: the global `/graph/events` stream is
   * deprecated in favour of the run-scoped, authorized, replayable
   * `GET /graph/runs/{runId}/events` transport. It is kept, not removed,
   * within this specification; no new features are routed through global
   * streams.
   */
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
