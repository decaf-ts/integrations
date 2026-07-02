/**
 * @module integrations/graph/execution/GraphExecutionFrame
 * @summary Per-run state container for graph execution.
 * @description Holds the run id, execution plan, value store, accumulated node results, events, and timing for a single workflow execution.
 */
import type { GraphExecutionPlan } from "../planning/GraphExecutionPlan";
import type { GraphValueStore } from "../store/GraphValueStore";
import type { GraphExecutionEventFactory } from "../events/GraphExecutionEventFactory";
import type {
  GraphExecutionEvent,
  GraphNodeExecutionResult,
  GraphRunId,
} from "../types";

/**
 * Mutable state for a single graph execution run.
 */
export class GraphExecutionFrame {
  readonly runId: GraphRunId;
  readonly plan: GraphExecutionPlan;
  readonly valueStore: GraphValueStore;
  readonly eventFactory: GraphExecutionEventFactory;
  readonly startedAt: Date;
  readonly nodeResults: Map<string, GraphNodeExecutionResult> = new Map();
  readonly events: GraphExecutionEvent[] = [];

  finishedAt?: Date;

  constructor(
    runId: GraphRunId,
    plan: GraphExecutionPlan,
    valueStore: GraphValueStore,
    eventFactory: GraphExecutionEventFactory
  ) {
    this.runId = runId;
    this.plan = plan;
    this.valueStore = valueStore;
    this.eventFactory = eventFactory;
    this.startedAt = new Date();
  }

  /** Records a node execution result. */
  recordNodeResult(result: GraphNodeExecutionResult): void {
    this.nodeResults.set(result.nodeId, result);
  }

  /** Appends an event to the run's event log. */
  appendEvent(event: GraphExecutionEvent): void {
    this.events.push(event);
  }

  /** Marks the run as finished. */
  finish(): void {
    this.finishedAt = new Date();
  }
}
