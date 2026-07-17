/**
 * @module integrations/tests/unit/graph/ForeachGraphNodeExecutor.test
 * @summary Unit tests for the Foreach loop executor (slice + break support).
 */
import { ForeachGraphNodeExecutor } from "../../../src/graph/engine/loops/ForeachGraphNodeExecutor";
import { BreakGraphNodeExecutor } from "../../../src/graph/engine/execution/BreakGraphNodeExecutor";
import { GraphBreakSignal } from "../../../src/graph/engine/errors/GraphBreakSignal";
import { GraphExecutionContext } from "../../../src/graph/engine/execution/GraphExecutionContext";
import { GraphInputError } from "../../../src/graph/engine/errors/GraphInputError";
import type { GraphExecutionEngine } from "../../../src/graph/engine/execution/GraphExecutionEngine";
import type { GraphNodeDefinition, GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

function buildContext(loopMeta: Record<string, unknown>): GraphExecutionContext {
  const node: GraphNodeDefinition = {
    name: "ForeachNode",
    tag: "ForeachNode",
    kind: "core.loop.foreach",
    labels: [],
    ports: [],
    graph: { metadata: { loop: loopMeta } } as never,
  };
  const workflow = { name: "wf" } as GraphWorkflowDefinition;
  return new GraphExecutionContext(
    "run-1",
    undefined,
    workflow,
    node,
    ["ForeachNode"],
    async () => {},
    {}
  );
}

/**
 * Builds a fake engine whose `execute` returns the item doubled on the
 * `result` port. When `breakAt` is set, the body throws a GraphBreakSignal
 * carrying the item on that iteration index.
 */
function buildEngine(breakAt: number | null = null): GraphExecutionEngine {
  return {
    execute: async (_wf: unknown, inputs: Record<string, unknown>) => {
      const index = inputs.index as number;
      if (breakAt !== null && index === breakAt) {
        throw new GraphBreakSignal(inputs.item);
      }
      return { outputs: { result: (inputs.item as number) * 2 } };
    },
  } as unknown as GraphExecutionEngine;
}

describe("ForeachGraphNodeExecutor", () => {
  it("iterates once per item and collects results", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {}, itemPort: "item", resultPort: "result" });
    const out = await executor.execute({ items: [1, 2, 3] }, ctx);
    expect(out.results).toEqual([2, 4, 6]);
    expect(out.completed).toEqual([2, 4, 6]);
    expect(out.iterations).toBe(3);
    expect(out.broken).toBe(false);
  });

  it("rejects non-array items", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {} });
    await expect(executor.execute({ items: "nope" } as never, ctx)).rejects.toBeInstanceOf(
      GraphInputError
    );
  });

  it("groups items into slices and iterates once per slice", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {}, slice: 2, itemPort: "item", resultPort: "result" });
    const out = await executor.execute({ items: [1, 2, 3, 4, 5] }, ctx);
    // 5 items / slice 2 => 3 iterations (slices: [1,2], [3,4], [5])
    expect(out.iterations).toBe(3);
    // body receives a slice array; mock doubles the slice array (NaN) — just check count
    expect(out.results).toHaveLength(3);
  });

  it("stops early when the body throws a GraphBreakSignal", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine(1));
    const ctx = buildContext({ body: {}, itemPort: "item", resultPort: "result" });
    const out = await executor.execute({ items: [1, 2, 3, 4] }, ctx);
    // iteration 0 succeeds (result 2), iteration 1 breaks carrying item 2
    expect(out.broken).toBe(true);
    expect(out.iterations).toBe(2);
    expect(out.results).toEqual([2, 2]);
  });

  it("uses slice from input port over metadata", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {}, slice: 5, itemPort: "item", resultPort: "result" });
    const out = await executor.execute({ items: [1, 2, 3, 4], slice: 2 }, ctx);
    expect(out.iterations).toBe(2);
  });
});

describe("BreakGraphNodeExecutor", () => {
  it("throws a GraphBreakSignal carrying the input value", async () => {
    const executor = new BreakGraphNodeExecutor();
    const ctx = buildContext({});
    await expect(
      executor.execute({ value: "stop" }, ctx)
    ).rejects.toBeInstanceOf(GraphBreakSignal);
    try {
      await executor.execute({ value: "stop" }, ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(GraphBreakSignal);
      expect((err as GraphBreakSignal).details).toEqual({ value: "stop" });
    }
  });
});
