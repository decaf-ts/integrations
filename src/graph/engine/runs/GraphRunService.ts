import { ForbiddenError } from "@decaf-ts/core";
import { NotFoundError, ValidationError } from "@decaf-ts/db-decorators";
import type { Context, MaybeContextualArg } from "@decaf-ts/core";
import {
  isGraphJsonSafeValue,
  isGraphWorkflowDocumentShape,
  type GraphWorkflowDocument,
} from "@decaf-ts/ui-decorators/graph";
import { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import {
  GraphRunEventPublisher,
  GraphRunExecutor,
  type GraphRunDocumentProvider,
} from "./index";
import { graphRunDocumentFingerprint } from "./GraphRunFingerprint";
import {
  DEFAULT_GRAPH_RUN_LIMITS,
  isGraphRunTerminalStatus,
  type GraphRun,
  type GraphRunCreateRequest,
  type GraphRunDocumentResolver,
  type GraphRunEventEnvelope,
  type GraphRunEventStore,
  type GraphRunLimits,
  type GraphRunStore,
} from "./types";

/** Construction options for {@link GraphRunService}. */
export interface GraphRunServiceOptions {
  /** Run limits (timeouts, event payload caps, concurrency); defaults from {@link DEFAULT_GRAPH_RUN_LIMITS}. */
  limits?: GraphRunLimits;
  /** Resolves saved workflow documents for by-`workflowId` run requests. */
  documentResolver?: GraphRunDocumentResolver;
  /** Called once per run when it reaches a terminal state. */
  onRunCompleted?: (
    run: GraphRun,
    result?: GraphRun["result"]
  ) => Promise<void>;
}

/**
 * Run lifecycle service (DECAF-50 §4.16): creates, tracks, cancels, and
 * observes graph runs on top of a {@link GraphRunStore} and
 * {@link GraphRunEventStore}. Enforces run limits (concurrency, timeout,
 * event payload size), scopes every read/cancel to the owning user, and
 * exposes the sequenced event stream the SSE controller replays.
 */
export class GraphRunService {
  private readonly engine: GraphExecutionEngine;
  private readonly runStore: GraphRunStore;
  private readonly eventStore: GraphRunEventStore;
  private readonly publisher: GraphRunEventPublisher;
  private readonly executor: GraphRunExecutor;
  private readonly options: GraphRunServiceOptions & {
    limits: Required<GraphRunLimits>;
  };
  private readonly active = new Set<string>();

  constructor(
    engine: GraphExecutionEngine,
    runStore: GraphRunStore,
    eventStore: GraphRunEventStore,
    options: GraphRunServiceOptions = {}
  ) {
    this.engine = engine;
    this.runStore = runStore;
    this.eventStore = eventStore;
    this.publisher = new GraphRunEventPublisher(eventStore, options.limits);
    this.executor = new GraphRunExecutor(
      engine,
      runStore,
      this.publisher,
      { onRunCompleted: options.onRunCompleted },
      options.limits
    );
    this.options = {
      ...options,
      limits: { ...DEFAULT_GRAPH_RUN_LIMITS, ...options.limits },
    };
  }

  /** Effective run limits, with defaults applied. */
  get limits(): Required<GraphRunLimits> {
    return this.options.limits;
  }

  /**
   * Creates and schedules a run for a saved `workflowId` or an inline
   * workflow document, enforcing the concurrency limit and ownership
   * bookkeeping. Returns the queued run immediately; execution continues in
   * the background.
   *
   * @throws ValidationError when the request carries no workflow identity, a
   * `workflowId` without a configured resolver, or the concurrency limit is
   * exhausted.
   */
  async createRun(
    request: GraphRunCreateRequest,
    ownerUser: string | null,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphRun> {
    this.validateCreateRequest(request);

    const workflowId = request.workflowId ?? request.workflow?.id ?? "";
    if (!workflowId) {
      throw new ValidationError(
        "Graph run request must carry a workflow document with an id or a saved workflowId"
      );
    }
    if (request.workflowId && !this.options.documentResolver) {
      throw new ValidationError(
        "Graph run requests by workflowId require a document resolver"
      );
    }

    if (this.active.size >= this.options.limits.maxConcurrentRuns) {
      throw new ValidationError(
        `Graph run rejected: the configured limit of ${this.options.limits.maxConcurrentRuns} concurrent runs is exhausted`
      );
    }

    const runId = this.generateRunId();
    const run: GraphRun = {
      runId,
      workflowId,
      ownerUser,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    this.executor.begin(runId);
    await this.runStore.saveRun({ ...run }, ...args);

    const provider = this.documentProviderFor(request, ownerUser);
    this.active.add(runId);
    const completion = this.executor.schedule(
      run,
      provider,
      request.inputs ?? {},
      ...args
    );
    void completion
      .catch(() => undefined)
      .finally(() => this.active.delete(runId));

    return run;
  }

  /** Reads a run, asserting it belongs to `ownerUser`. */
  async getRun(
    runId: string,
    ownerUser: string | null,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphRun> {
    const run = await this.runStore.readRun(runId, ...args);
    if (!run) {
      throw new NotFoundError(`No graph run found for runId '${runId}'`);
    }
    this.assertOwnership(run, ownerUser);
    return run;
  }

  /**
   * Cancels a non-terminal run: aborts in-flight execution and persists the
   * `cancelled` status. Terminal runs are returned unchanged.
   */
  async cancelRun(
    runId: string,
    ownerUser: string | null,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphRun> {
    const run = await this.runStore.readRun(runId, ...args);
    if (!run) {
      throw new NotFoundError(`No graph run found for runId '${runId}'`);
    }
    this.assertOwnership(run, ownerUser);

    if (isGraphRunTerminalStatus(run.status)) {
      return run;
    }

    this.executor.abort(runId, "user");
    run.status = "cancelled";
    run.finishedAt = new Date().toISOString();
    await this.runStore.saveRun({ ...run }, ...args);
    return run;
  }

  /** Lists a run's event envelopes after the given sequence (ownership-checked). */
  async listEvents(
    runId: string,
    afterSequence: number,
    ownerUser: string | null,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphRunEventEnvelope[]> {
    await this.getRun(runId, ownerUser, ...args);
    return this.eventStore.listAfter(runId, afterSequence);
  }

  /** Subscribes a live listener to a run's event stream (ownership-checked); returns an unsubscribe function. */
  async subscribeEvents(
    runId: string,
    ownerUser: string | null,
    listener: (event: GraphRunEventEnvelope) => void,
    ...args: MaybeContextualArg<Context>
  ): Promise<() => void> {
    await this.getRun(runId, ownerUser, ...args);
    return this.eventStore.subscribe(runId, listener);
  }

  /** Subscribes a listener to a run's event stream without re-reading the run. */
  subscribeRunEvents(
    run: GraphRun,
    listener: (event: GraphRunEventEnvelope) => void
  ): () => void {
    return this.eventStore.subscribe(run.runId, listener);
  }

  /** Waits for a scheduled run to finish, then returns its final state. */
  async waitForRun(
    runId: string,
    ownerUser: string | null,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphRun> {
    const completion = this.executor.waitFor(runId);
    if (completion) await completion;
    return this.getRun(runId, ownerUser, ...args);
  }

  /** Convenience helper: creates a run and waits for its completion. */
  async executeAndWait(
    request: GraphRunCreateRequest,
    ownerUser: string | null,
    ...args: MaybeContextualArg<Context>
  ): Promise<GraphRun> {
    const run = await this.createRun(request, ownerUser, ...args);
    return this.waitForRun(run.runId, ownerUser, ...args);
  }

  /** Releases all per-run bookkeeping for a finished run. */
  release(runId: string): void {
    this.active.delete(runId);
    this.executor.release(runId);
  }

  private validateCreateRequest(request: GraphRunCreateRequest): void {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new ValidationError(
        "Graph run request must be an object carrying either a workflow document or a workflowId plus inputs"
      );
    }
    const hasDocument = request.workflow !== undefined;
    const hasWorkflowId = request.workflowId !== undefined;
    if (hasDocument && hasWorkflowId) {
      throw new ValidationError(
        "Graph run request is ambiguous: supply either an unsaved workflow document or a saved workflowId, not both"
      );
    }
    if (!hasDocument && !hasWorkflowId) {
      throw new ValidationError(
        "Graph run request must supply either an unsaved workflow document or a saved workflowId"
      );
    }
    if (hasDocument && !isGraphWorkflowDocumentShape(request.workflow)) {
      throw new ValidationError(
        "Graph run request carries a payload that is not a canonical GraphWorkflowDocument"
      );
    }
    if (request.inputs !== undefined && !isGraphJsonSafeValue(request.inputs)) {
      throw new ValidationError(
        "Graph run inputs must be JSON-safe: functions, class instances, undefined, NaN/Infinity, symbol keys and unsafe prototype keys (__proto__/prototype/constructor) are rejected"
      );
    }
    const bytes = safeJsonLength(request);
    if (bytes > this.options.limits.maxRequestBytes) {
      throw new ValidationError(
        `Graph run request of ${bytes} bytes exceeds the configured limit of ${this.options.limits.maxRequestBytes} bytes`
      );
    }
  }

  private documentProviderFor(
    request: GraphRunCreateRequest,
    ownerUser: string | null
  ): GraphRunDocumentProvider {
    if (request.workflow) {
      const document = request.workflow;
      return async () => ({
        document,
        fingerprint: graphRunDocumentFingerprint(document),
      });
    }
    const workflowId = request.workflowId as string;
    return async (...args: MaybeContextualArg<Context>) => {
      const resolver = this.options.documentResolver;
      if (!resolver) {
        throw new ValidationError(
          "Graph run requests by workflowId require a document resolver"
        );
      }
      const document: GraphWorkflowDocument = await resolver.resolve(
        workflowId,
        ownerUser,
        ...args
      );
      return {
        document,
        fingerprint: graphRunDocumentFingerprint(document),
      };
    };
  }

  private assertOwnership(run: GraphRun, ownerUser: string | null): void {
    if (!run.ownerUser || !ownerUser || run.ownerUser === ownerUser) return;
    throw new ForbiddenError(
      `Graph run '${run.runId}' is owned by another user`
    );
  }

  private generateRunId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `graph-run-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
