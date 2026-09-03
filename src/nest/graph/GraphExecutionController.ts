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
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { concatMap, filter } from "rxjs/operators";

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
import { ValidationError, NotFoundError } from "@decaf-ts/db-decorators";
import { AuthorizationError, ForbiddenError } from "@decaf-ts/core";
import { DecafRequestContext } from "@decaf-ts/for-nest";

import { GraphResultService } from "./GraphResultService";
import { GraphWorkflowService, graphWorkflowOwnerOf } from "./GraphWorkflowService";

/** DI token for {@link GraphExecutionControllerOptions}. */
export const GRAPH_EXECUTION_OPTIONS = "GRAPH_EXECUTION_OPTIONS";

/**
 * Options for the legacy execution surface (SAA-595): the deprecated global
 * SSE stream is disabled unless explicitly enabled, and when enabled every
 * emitted event is ownership-gated against the connected caller.
 */
export interface GraphExecutionControllerOptions {
  /**
   * Whether the deprecated global `GET /graph/events` SSE stream is exposed
   * at all. Defaults to `false`: the run-scoped, replayable
   * `GET /graph/runs/{runId}/events` transport is the canonical stream
   * (DECAF-50 §4.15). When `true`, each connected caller only receives
   * events for runs they own.
   */
  enableGlobalEventStream?: boolean;
}

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
    @Optional() @Inject(GRAPH_EXECUTION_OPTIONS)
    private readonly options: GraphExecutionControllerOptions = {},
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
    const owner = graphWorkflowOwnerOf(this.requestContext) ?? null;
    const run = await this.runService.executeAndWait(
      { workflow: document, inputs: body.inputs ?? {} },
      owner,
      this.concurrencyKeyOf(owner),
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
   * @deprecated DECAF-50 §4.15 cutover (SAA-595 F2): the global `/graph/events`
   * stream is disabled by default — the run-scoped, authorized, replayable
   * `GET /graph/runs/{runId}/events` transport is the canonical stream. Hosts
   * with a residual transition need may re-enable it explicitly via
   * {@link GraphExecutionControllerOptions.enableGlobalEventStream}; every
   * event is then ownership-gated at emit: a connected caller only ever
   * receives events for runs they own.
   */
  @Sse("events")
  events(): Observable<MessageEvent> {
    if (this.options.enableGlobalEventStream !== true) {
      throw new HttpException(
        "The global graph event stream is disabled; use the run-scoped GET /graph/runs/{runId}/events transport",
        HttpStatus.NOT_FOUND
      );
    }
    const caller = graphWorkflowOwnerOf(this.requestContext) ?? null;
    return this.eventSubject.asObservable().pipe(
      concatMap(async (event: GraphExecutionEvent) => {
        return (await this.callerOwnsRun(caller, event.runId))
          ? this.messageOf(event)
          : null;
      }),
      filter((message): message is MessageEvent => message !== null)
    );
  }

  /** Encodes one engine event in the global stream's wire format: a `["graph", type, runId, envelope]` SSE message tuple. */
  private messageOf(event: GraphExecutionEvent): MessageEvent {
    return {
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
    };
  }

  /** Strict ownership gate for the global stream: only run owners see their runs' events. */
  private async callerOwnsRun(
    caller: string | null,
    runId: string
  ): Promise<boolean> {
    try {
      const run = await this.runService.getRun(
        runId,
        caller,
        this.requestContext
      );
      return (run.ownerUser ?? null) === caller;
    } catch {
      return false;
    }
  }

  /**
   * Reads a persisted execution result by run id (DECAF-50 §4.18). Gated
   * through the centralized run ownership check first (SAA-595 F1): a
   * cross-user or anonymous caller gets `403` for a run owned by another
   * user before any result data is read.
   */
  @Get("results/:runId")
  async getResult(@Param("runId") runId: string): Promise<unknown> {
    const owner = graphWorkflowOwnerOf(this.requestContext) ?? null;
    try {
      await this.runService.getRun(runId, owner, this.requestContext);
    } catch (e: unknown) {
      throw graphExecutionHttpErrorOf(e, runId);
    }
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

  /** Concurrency-bucket key for the per-caller run cap: the owner, else the request IP, else a shared anonymous bucket. */
  private concurrencyKeyOf(owner: string | null): string {
    if (owner) return owner;
    const ip = (
      this.requestContext as unknown as
        | { request?: { ip?: string } }
        | undefined
    )?.request?.ip;
    return ip ? `ip:${ip}` : "anonymous";
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

/**
 * Maps a thrown Decaf error to the Nest HTTP equivalent for the execution
 * surface: ownership/authorization failures become `403` (naming the run),
 * missing resources `404`, validation failures `400`, and anything else
 * surfaces as `500` with its message. Nest {@link HttpException}s pass
 * through unchanged.
 */
function graphExecutionHttpErrorOf(e: unknown, runId?: string): HttpException {
  if (e instanceof ForbiddenError || e instanceof AuthorizationError) {
    return new HttpException(
      runId ? `Graph run '${runId}' is owned by another user` : e.message,
      HttpStatus.FORBIDDEN
    );
  }
  if (e instanceof NotFoundError) {
    return new NotFoundException(e.message);
  }
  if (e instanceof ValidationError) {
    return new HttpException(e.message, HttpStatus.BAD_REQUEST);
  }
  if (e instanceof HttpException) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
}
