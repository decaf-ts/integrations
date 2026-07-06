/**
 * @module integrations/nest/graph/GraphExecutionController
 * @summary NestJS controller bridging the graph execution engine to REST + SSE.
 * @description Exposes three endpoints:
 * - `POST /graph/execute` — triggers {@link GraphExecutionEngine.execute}, persists the result via a Decaf repository, and returns `{ runId, status, outputs }`.
 * - `GET /graph/events` — SSE endpoint streaming {@link GraphExecutionEvent}s as `[modelName, operation, id, payload]` tuples (compatible with for-http's `ServerEventConnector`).
 * - `GET /graph/results/:runId` — retrieves a persisted {@link GraphExecutionResultModel} from the repository.
 *
 * This is the production pattern: for-nest hosts the engine, for-angular consumes events over the network via SSE and fetches persisted results via REST.
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Sse,
  MessageEvent,
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

import {
  fromResultModel,
  toResultModel,
  type GraphExecutionResultRepositoryInstance,
} from "./GraphExecutionResultRepository";
import type { GraphExecutionResultModel } from "./GraphExecutionResultModel";

/**
 * NestJS injection token for the graph execution result repository.
 */
export const GRAPH_RESULT_REPOSITORY = "GRAPH_RESULT_REPOSITORY";

/**
 * Payload for the `POST /graph/execute` endpoint.
 */
export interface GraphExecutePayload {
  workflow: GraphWorkflowDefinition;
  inputs: GraphExecutionValues;
}

/**
 * Response shape for the `POST /graph/execute` endpoint.
 */
export interface GraphExecuteResponse {
  runId: string;
  status: string;
  outputs: Record<string, unknown>;
}

/**
 * NestJS controller that hosts the graph execution engine server-side,
 * streams events via SSE, and persists results for later retrieval.
 */
@Controller("graph")
export class GraphExecutionController {
  private readonly eventSubject = new Subject<GraphExecutionEvent>();

  constructor(
    private readonly engine: GraphExecutionEngine,
    @Inject(GRAPH_RESULT_REPOSITORY)
    private readonly resultRepository: GraphExecutionResultRepositoryInstance
  ) {
    this.engine.observe({
      refresh: async (event) => {
        this.eventSubject.next(event);
      },
    });
  }

  /**
   * Triggers graph execution server-side, persists the result, and returns
   * a summary containing the `runId`, `status`, and `outputs`.
   */
  @Post("execute")
  async execute(
    @Body() body: GraphExecutePayload
  ): Promise<GraphExecuteResponse> {
    const result = await this.engine.execute(body.workflow, body.inputs ?? {});

    try {
      await this.resultRepository.create(toResultModel(result));
    } catch {
      // persistence failures must not mask a successful execution result
    }

    return {
      runId: result.runId,
      status: result.status,
      outputs: result.outputs,
    };
  }

  /**
   * SSE endpoint that streams graph execution events.
   *
   * Events are serialized as `[modelName, operation, id, payload]` to match
   * the format expected by for-http's `ServerEventConnector`.
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

  /**
   * Retrieves a persisted graph execution result by its `runId`.
   *
   * @throws {NotFoundException} when no result is stored for the given `runId`.
   */
  @Get("results/:runId")
  async getResult(@Param("runId") runId: string): Promise<unknown> {
    let model: GraphExecutionResultModel | null;
    try {
      model = (await this.resultRepository.read(
        runId
      )) as GraphExecutionResultModel | null;
    } catch {
      model = null;
    }
    const result = fromResultModel(model);
    if (!result) {
      throw new NotFoundException(
        `No graph execution result found for runId '${runId}'`
      );
    }
    return result;
  }
}
