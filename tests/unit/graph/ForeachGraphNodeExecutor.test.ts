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
import type {
  GraphNodeInstance,
  GraphWorkflowDocument,
} from "@decaf-ts/ui-decorators/graph";
import type { GraphResolvedNodeManifest } from "../../../src/graph/shared/GraphResolution";
import { nodeExecutionRequest } from "./fixtures";

/**
 * Builds a minimal {@link GraphExecutionContext} for a Foreach node from a
 * legacy loop-metadata bag: rule-6 configuration fields (itemPort,
 * resultPort, statePort, slice, ...) land in the instance `parameters`;
 * body/maxIterations live on `instance.loop` (DECAF-50 §4.4.5/§4.9).
 */
function buildContext(loopMeta: Record<string, unknown>): GraphExecutionContext {
  const { body, maxIterations, timeoutMs, concurrency, ...parameters } = loopMeta;
  const node: GraphNodeInstance = {
    id: "ForeachNode",
    kind: "core.loop.foreach",
    parameters: parameters as Record<string, never>,
    loop: { body: body as GraphWorkflowDocument, maxIterations: maxIterations as number | undefined, timeoutMs: timeoutMs as number | undefined, concurrency: concurrency as number | undefined },
  };
  const document: GraphWorkflowDocument = {
    id: "wf",
    name: "wf",
    inputs: [],
    outputs: [],
    nodes: [],
    edges: [],
  };
  const manifest: GraphResolvedNodeManifest = {
    kind: "core.loop.foreach",
    display: { name: "Foreach" },
    inputs: [],
    outputs: [],
    parameters: [],
    capabilities: ["loop"],
  };
  return new GraphExecutionContext(
    "run-1",
    undefined,
    "wf",
    document,
    node,
    manifest,
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
    const out = await executor.execute(
      nodeExecutionRequest({ items: [1, 2, 3] }),
      ctx
    );
    expect(out.results).toEqual([2, 4, 6]);
    expect(out.completed).toEqual([2, 4, 6]);
    expect(out.iterations).toBe(3);
    expect(out.broken).toBe(false);
  });

  it("rejects non-array items", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {} });
    await expect(
      executor.execute(nodeExecutionRequest({ items: "nope" }), ctx)
    ).rejects.toBeInstanceOf(
      GraphInputError
    );
  });

  it("groups items into slices and iterates once per slice", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {}, slice: 2, itemPort: "item", resultPort: "result" });
    const out = await executor.execute(
      nodeExecutionRequest({ items: [1, 2, 3, 4, 5] }),
      ctx
    );
    // 5 items / slice 2 => 3 iterations (slices: [1,2], [3,4], [5])
    expect(out.iterations).toBe(3);
    // body receives a slice array; mock doubles the slice array (NaN) — just check count
    expect(out.results).toHaveLength(3);
  });

  it("stops early when the body throws a GraphBreakSignal", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine(1));
    const ctx = buildContext({ body: {}, itemPort: "item", resultPort: "result" });
    const out = await executor.execute(
      nodeExecutionRequest({ items: [1, 2, 3, 4] }),
      ctx
    );
    // iteration 0 succeeds (result 2), iteration 1 breaks carrying item 2
    expect(out.broken).toBe(true);
    expect(out.iterations).toBe(2);
    expect(out.results).toEqual([2, 2]);
  });

  it("uses slice from input port over metadata", async () => {
    const executor = new ForeachGraphNodeExecutor(buildEngine());
    const ctx = buildContext({ body: {}, slice: 5, itemPort: "item", resultPort: "result" });
    const out = await executor.execute(
      nodeExecutionRequest({ items: [1, 2, 3, 4], slice: 2 }),
      ctx
    );
    expect(out.iterations).toBe(2);
  });
});

describe("BreakGraphNodeExecutor", () => {
  it("throws a GraphBreakSignal carrying the input value", async () => {
    const executor = new BreakGraphNodeExecutor();
    const ctx = buildContext({});
    await expect(
      executor.execute(nodeExecutionRequest({ value: "stop" }), ctx)
    ).rejects.toBeInstanceOf(GraphBreakSignal);
    try {
      await executor.execute(nodeExecutionRequest({ value: "stop" }), ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(GraphBreakSignal);
      expect((err as GraphBreakSignal).details).toEqual({ value: "stop" });
    }
  });
});
