/**
 * @module integrations/tests/e2e/graph/GraphExecutionController
 * @summary NestJS controller that bridges the graph execution engine to SSE.
 * @description Exposes POST /graph/execute to trigger server-side graph execution and GET /graph/events to stream execution events via Server-Sent Events. This mirrors the production pipeline: for-nest hosts the engine, for-angular consumes events via SSE.
 */
import { Controller, Post, Body, Sse, MessageEvent } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { map } from "rxjs/operators";

import {
  GraphExecutionEngine,
  GraphNodeExecutorRegistry,
  type GraphExecutionEvent,
  type GraphExecutionValues,
  type GraphWorkflowDefinition,
} from "../../../src/graph";

/**
 * Payload for the execute endpoint.
 */
export interface GraphExecutePayload {
  workflow: GraphWorkflowDefinition;
  inputs: GraphExecutionValues;
}

/**
 * NestJS controller that hosts the graph execution engine server-side and
 * streams events via SSE. This is the production pattern: the engine runs in
 * for-nest, and clients (for-angular) consume events over the network.
 */
@Controller("graph")
export class GraphExecutionController {
  private readonly engine: GraphExecutionEngine;
  private readonly eventSubject = new Subject<GraphExecutionEvent>();

  constructor() {
    const registry = new GraphNodeExecutorRegistry();
    registry.register("math.add", {
      execute: (input) => ({ sum: Number(input.a) + Number(input.b) }),
    });
    registry.register("math.multiply", {
      execute: (input) => ({ product: Number(input.x) * 2 }),
    });

    this.engine = new GraphExecutionEngine({ registry });

    this.engine.observe({
      refresh: async (event) => {
        this.eventSubject.next(event);
      },
    });
  }

  /**
   * Triggers graph execution server-side. Returns the full result.
   */
  @Post("execute")
  async execute(
    @Body() body: GraphExecutePayload
  ): Promise<{
    runId: string;
    status: string;
    outputs: Record<string, unknown>;
  }> {
    const result = await this.engine.execute(body.workflow, body.inputs ?? {});
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
}
