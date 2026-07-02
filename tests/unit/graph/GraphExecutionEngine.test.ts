/**
 * @module integrations/tests/unit/graph/GraphExecutionEngine.test
 * @summary End-to-end unit tests for the graph execution engine.
 */
import { GraphExecutionEventType } from "../../../src/graph/constants";
import { GraphExecutionEngine } from "../../../src/graph/execution/GraphExecutionEngine";
import type { GraphNodeExecutor } from "../../../src/graph/execution/GraphNodeExecutor";
import { GraphNodeExecutorRegistry } from "../../../src/graph/registry/GraphNodeExecutorRegistry";
import type { GraphExecutionEvent } from "../../../src/graph/types";

import { linearWorkflow } from "./fixtures";

describe("GraphExecutionEngine", () => {
  function buildEngine(): {
    engine: GraphExecutionEngine;
    events: GraphExecutionEvent[];
  } {
    const registry = new GraphNodeExecutorRegistry();
    const adder: GraphNodeExecutor = {
      execute: (input) => ({ sum: Number(input.a) + Number(input.b) }),
    };
    const multiplier: GraphNodeExecutor = {
      execute: (input) => ({ product: Number(input.x) * 2 }),
    };
    registry.register("math.add", adder);
    registry.register("math.multiply", multiplier);

    const events: GraphExecutionEvent[] = [];
    const engine = new GraphExecutionEngine({ registry });
    engine.observe({
      refresh: async (event) => { events.push(event); },
    });
    return { engine, events };
  }

  it("executes a linear workflow and produces correct outputs", async () => {
    const { engine } = buildEngine();
    const result = await engine.execute(linearWorkflow(), { a: 2, b: 3 });

    expect(result.status).toBe("succeeded");
    expect(result.outputs.result).toBe(10); // (2+3) * 2
    expect(result.nodeResults.adder.outputs?.sum).toBe(5);
    expect(result.nodeResults.multiplier.outputs?.product).toBe(10);
  });

  it("emits workflow started, planned, and completed events", async () => {
    const { engine, events } = buildEngine();
    await engine.execute(linearWorkflow(), { a: 1, b: 1 });

    const types = events.map((e) => e.type);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_STARTED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_PLANNED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_COMPLETED);
  });

  it("emits node started and completed events for each node", async () => {
    const { engine, events } = buildEngine();
    await engine.execute(linearWorkflow(), { a: 1, b: 1 });

    const started = events.filter(
      (e) => e.type === GraphExecutionEventType.NODE_STARTED
    );
    const completed = events.filter(
      (e) => e.type === GraphExecutionEventType.NODE_COMPLETED
    );
    expect(started.length).toBe(2);
    expect(completed.length).toBe(2);
  });

  it("emits edge value routed events", async () => {
    const { engine, events } = buildEngine();
    await engine.execute(linearWorkflow(), { a: 1, b: 1 });

    const routed = events.filter(
      (e) => e.type === GraphExecutionEventType.EDGE_VALUE_ROUTED
    );
    // adder->multiplier and multiplier->workflow.result are routed;
    // boundary->adder edges are read in resolveNodeInputs, not routed.
    expect(routed.length).toBe(2);
  });

  it("captures a failed node and reports the error", async () => {
    const registry = new GraphNodeExecutorRegistry();
    registry.register("math.add", {
      execute: () => { throw new Error("addition failed"); },
    });
    registry.register("math.multiply", {
      execute: (input) => ({ product: Number(input.x) }),
    });
    const engine = new GraphExecutionEngine({ registry });

    const result = await engine.execute(linearWorkflow(), { a: 1, b: 1 });

    expect(result.status).toBe("failed");
    expect(result.nodeResults.adder.error?.message).toBe("addition failed");
  });

  it("returns a runId and records timing", async () => {
    const { engine } = buildEngine();
    const result = await engine.execute(linearWorkflow(), { a: 1, b: 1 });

    expect(result.runId).toBeTruthy();
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.finishedAt).toBeInstanceOf(Date);
  });

  it("events have unique ids and incrementing sequence numbers", async () => {
    const { engine, events } = buildEngine();
    await engine.execute(linearWorkflow(), { a: 1, b: 1 });

    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(events.length);
    const seqs = events.map((e) => e.sequence);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("supports custom runId via options", async () => {
    const { engine } = buildEngine();
    const result = await engine.execute(linearWorkflow(), { a: 1, b: 1 }, {
      runId: "custom-run",
    });
    expect(result.runId).toBe("custom-run");
  });

  it("observer failures do not crash execution", async () => {
    const registry = new GraphNodeExecutorRegistry();
    registry.register("math.add", {
      execute: (input) => ({ sum: Number(input.a) + Number(input.b) }),
    });
    registry.register("math.multiply", {
      execute: (input) => ({ product: Number(input.x) }),
    });
    const engine = new GraphExecutionEngine({ registry });
    engine.observe({
      refresh: async () => { throw new Error("observer crashed"); },
    });

    const result = await engine.execute(linearWorkflow(), { a: 1, b: 1 });
    expect(result.status).toBe("succeeded");
  });
});
