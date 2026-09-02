import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Sse,
  MessageEvent,
  Inject,
  HttpCode,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { NotFoundError, ValidationError } from "@decaf-ts/db-decorators";
import { AuthorizationError, ForbiddenError } from "@decaf-ts/core";
import type { GraphWorkflowDocument } from "@decaf-ts/ui-decorators/graph";
import { DecafRequestContext } from "@decaf-ts/for-nest";
import type {
  GraphExecutionValues,
  GraphRun,
  GraphRunEventEnvelope,
  GraphRunLimits,
  GraphRunCreateRequest,
} from "../../graph";
import {
  isGraphRunTerminalEventType,
  GraphRunService,
} from "../../graph";
import { graphWorkflowOwnerOf } from "./GraphWorkflowService";

/** DI token for {@link GraphRunControllerOptions}. */
export const GRAPH_RUN_OPTIONS = "GRAPH_RUN_OPTIONS";

/** Options for the run lifecycle HTTP API (DECAF-50 §4.14–§4.15): authentication mode and run limits. */
export interface GraphRunControllerOptions {
  /** Whether an authenticated request context is required (default `"optional"`). */
  auth?: "required" | "optional";
  /** Run limits forwarded to {@link GraphRunService}. */
  limits?: GraphRunLimits;
}

/** Response of `POST /graph/runs`: the queued run's identity and its event/result URLs. */
export interface GraphRunCreatedResponse {
  runId: string;
  workflowId: string;
  status: "queued";
  eventsUrl: string;
  resultUrl: string;
}

/** Request body for creating a run: an inline workflow document or a saved `workflowId`, plus optional inputs. */
export interface GraphRunRequestBody {
  workflow?: GraphWorkflowDocument;
  workflowId?: string;
  inputs?: GraphExecutionValues;
}

function graphRunHttpErrorOf(e: unknown, runId?: string): HttpException {
  if (e instanceof ForbiddenError || e instanceof AuthorizationError) {
    return new HttpException(
      runId
        ? `Graph run '${runId}' is owned by another user`
        : e.message,
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

function graphRunToHttp(run: GraphRun): Record<string, unknown> {
  return JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
}

function graphRunEventMessage(event: GraphRunEventEnvelope): MessageEvent {
  return {
    type: "message",
    data: JSON.stringify(event),
  };
}

/**
 * Asynchronous run lifecycle HTTP API (DECAF-50 §4.14–§4.15):
 * `POST /graph/runs` creates and schedules a run (202 Accepted), run
 * read/cancel endpoints expose lifecycle state, and
 * `GET /graph/runs/:runId/events` streams the run's sequenced event
 * envelopes over SSE until a terminal event closes the stream. Every
 * operation is ownership-checked against the requesting user.
 */
@Controller("graph")
export class GraphRunController {
  constructor(
    private readonly runService: GraphRunService,
    @Optional() @Inject(DecafRequestContext)
    private readonly requestContext?: DecafRequestContext,
    @Optional() @Inject(GRAPH_RUN_OPTIONS)
    private readonly options: GraphRunControllerOptions = {}
  ) {}

  private requireAuthenticatedContext(): DecafRequestContext | undefined {
    if ((this.options.auth ?? "optional") !== "required") {
      return this.requestContext;
    }
    if (!this.requestContext) {
      throw new HttpException(
        "Graph run access requires an authenticated request context",
        HttpStatus.UNAUTHORIZED
      );
    }
    return this.requestContext;
  }

  private ownerUserOf(): string | null {
    return graphWorkflowOwnerOf(this.requestContext) ?? null;
  }

  @Post("runs")
  @HttpCode(HttpStatus.ACCEPTED)
  async createRun(
    @Body() body: GraphRunRequestBody
  ): Promise<GraphRunCreatedResponse> {
    const context = this.requireAuthenticatedContext();
    const request: GraphRunCreateRequest = {
      ...(body?.workflow !== undefined ? { workflow: body.workflow } : {}),
      ...(body?.workflowId !== undefined
        ? { workflowId: body.workflowId }
        : {}),
      ...(body?.inputs !== undefined ? { inputs: body.inputs } : {}),
    };
    try {
      const run = await this.runService.createRun(
        request,
        this.ownerUserOf(),
        context
      );
      return {
        runId: run.runId,
        workflowId: run.workflowId,
        status: "queued",
        eventsUrl: `/graph/runs/${run.runId}/events`,
        resultUrl: `/graph/runs/${run.runId}`,
      };
    } catch (e: unknown) {
      throw graphRunHttpErrorOf(e);
    }
  }

  @Get("runs/:runId")
  async getRun(@Param("runId") runId: string): Promise<Record<string, unknown>> {
    const context = this.requireAuthenticatedContext();
    try {
      const run = await this.runService.getRun(runId, this.ownerUserOf(), context);
      return graphRunToHttp(run);
    } catch (e: unknown) {
      throw graphRunHttpErrorOf(e, runId);
    }
  }

  @Delete("runs/:runId")
  async cancelRun(
    @Param("runId") runId: string
  ): Promise<Record<string, unknown>> {
    const context = this.requireAuthenticatedContext();
    try {
      const run = await this.runService.cancelRun(
        runId,
        this.ownerUserOf(),
        context
      );
      return graphRunToHttp(run);
    } catch (e: unknown) {
      throw graphRunHttpErrorOf(e, runId);
    }
  }

  @Sse("runs/:runId/events")
  async events(
    @Param("runId") runId: string,
    @Query("afterSequence") afterSequence?: string
  ): Promise<Observable<MessageEvent>> {
    const context = this.requireAuthenticatedContext();
    const owner = this.ownerUserOf();
    const after = this.parseAfterSequence(afterSequence);

    let run: GraphRun;
    try {
      run = await this.runService.getRun(runId, owner, context);
    } catch (e: unknown) {
      throw graphRunHttpErrorOf(e, runId);
    }

    const buffered: GraphRunEventEnvelope[] = [];
    let streaming = false;
    let completed = false;
    let sink: {
      next: (message: MessageEvent) => void;
      complete: () => void;
    } | undefined;

    const emit = (event: GraphRunEventEnvelope): void => {
      if (completed || !sink) return;
      sink.next(graphRunEventMessage(event));
      if (isGraphRunTerminalEventType(event.type)) {
        completed = true;
        unsubscribe();
        sink.complete();
      }
    };

    const unsubscribe = this.runService.subscribeRunEvents(run, (event) => {
      if (completed) return;
      if (streaming) emit(event);
      else buffered.push(event);
    });

    const replay = await this.runService.listEvents(
      runId,
      after,
      owner,
      context
    );
    const replayTerminal =
      replay.length > 0 &&
      isGraphRunTerminalEventType(replay[replay.length - 1].type);

    return new Observable<MessageEvent>((subscriber) => {
      sink = subscriber;
      let last = after;
      for (const event of replay) {
        if (completed) break;
        emit(event);
        last = Math.max(last, event.sequence);
      }

      if (!completed) {
        while (buffered.length > 0 && buffered[0].sequence <= last) {
          buffered.shift();
        }
        streaming = true;
        while (buffered.length > 0 && !completed) {
          emit(buffered.shift() as GraphRunEventEnvelope);
        }
      }

      if (replayTerminal && !completed) {
        completed = true;
        unsubscribe();
        subscriber.complete();
      }

      return () => {
        completed = true;
        unsubscribe();
      };
    });
  }

  private parseAfterSequence(afterSequence: string | undefined): number {
    if (afterSequence === undefined || afterSequence === "") return 0;
    if (!/^\d+$/.test(afterSequence)) {
      throw new HttpException(
        `Invalid afterSequence '${afterSequence}': must be a non-negative integer`,
        HttpStatus.BAD_REQUEST
      );
    }
    return Number.parseInt(afterSequence, 10);
  }
}
