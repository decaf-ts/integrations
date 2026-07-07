/**
 * @module integrations/graph/events/GraphExecutionEventFactory
 * @summary Factory for creating graph execution events with unique ids, sequence numbers, and timestamps.
 * @description Provides a stateful factory that produces monotonically-sequenced events for a single execution run.
 */
import type { GraphExecutionEvent } from "../types";

/**
 * Factory that enriches partial events with a unique id, an incrementing
 * sequence number, and a timestamp.
 */
export class GraphExecutionEventFactory {
  private sequence = 0;

  /**
   * Creates a fully-populated event from the given base fields.
   *
   * @param base - All event fields except `id`, `sequence`, and `timestamp`.
   * @returns A complete {@link GraphExecutionEvent}.
   */
  create(
    base: Omit<GraphExecutionEvent, "id" | "sequence" | "timestamp">
  ): GraphExecutionEvent {
    return {
      ...base,
      id: this.createEventId(),
      sequence: ++this.sequence,
      timestamp: new Date(),
    };
  }

  /**
   * Generates a unique event id using `crypto.randomUUID` when available,
   * falling back to a timestamp + random string.
   */
  private createEventId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }
}
