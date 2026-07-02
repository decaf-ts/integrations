/**
 * @module integrations/tests/unit/graph/GraphPinning.test
 * @summary Unit tests for the pinning policy, dependency resolver, and service.
 */
import { GraphExecutionPlanner } from "../../../src/graph/planning/GraphExecutionPlanner";
import { GraphPinningDependencyResolver } from "../../../src/graph/pinning/GraphPinningDependencyResolver";
import { GraphPinningPolicy } from "../../../src/graph/pinning/GraphPinningPolicy";
import { GraphPinningService } from "../../../src/graph/pinning/GraphPinningService";
import { InMemoryGraphValueStoreAdapter } from "../../../src/graph/store/InMemoryGraphValueStoreAdapter";
import { GraphValueStore } from "../../../src/graph/store/GraphValueStore";
import type { GraphExecutionPlanNode } from "../../../src/graph/planning/GraphExecutionPlanNode";
import type { GraphExecutionResult } from "../../../src/graph/types";

import { linearWorkflow } from "./fixtures";

function makePlanNode(id: string, pinnable: boolean): GraphExecutionPlanNode {
  return {
    id,
    kind: "test",
    label: id,
    source: { id } as any,
    definition: {
      name: id,
      tag: id,
      kind: "test",
      labels: [],
      ports: [],
      graph: { metadata: { pinnable: { enabled: pinnable, strategy: "manual", includeDependencies: true } } },
    } as any,
    inputPorts: [],
    outputPorts: [],
    metadata: {},
  };
}

describe("GraphPinningPolicy", () => {
  const policy = new GraphPinningPolicy();

  it("canPin returns true when metadata.enabled is true and strategy is not disabled", () => {
    expect(policy.canPin(makePlanNode("n1", true))).toBe(true);
  });

  it("canPin returns false when not enabled", () => {
    expect(policy.canPin(makePlanNode("n1", false))).toBe(false);
  });

  it("shouldUsePinnedValue respects enabled and strategy", () => {
    expect(policy.shouldUsePinnedValue(makePlanNode("n1", true))).toBe(true);
    expect(policy.shouldUsePinnedValue(makePlanNode("n1", false))).toBe(false);
  });

  it("shouldAutoPin returns true only for automatic strategy", () => {
    const node = makePlanNode("n1", true);
    (node.definition as any).graph.metadata.pinnable.strategy = "automatic";
    expect(policy.shouldAutoPin(node)).toBe(true);
    (node.definition as any).graph.metadata.pinnable.strategy = "manual";
    expect(policy.shouldAutoPin(node)).toBe(false);
  });
});

describe("GraphPinningDependencyResolver", () => {
  it("getDependencies returns upstream nodes excluding boundary", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const resolver = new GraphPinningDependencyResolver();
    const deps = resolver.getDependencies(plan, "multiplier");
    expect(deps.has("adder")).toBe(true);
  });

  it("getPinSet includes the node itself plus dependencies", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const resolver = new GraphPinningDependencyResolver();
    const set = resolver.getPinSet(plan, "multiplier");
    expect(set.has("multiplier")).toBe(true);
    expect(set.has("adder")).toBe(true);
  });
});

describe("GraphPinningService", () => {
  it("computeFingerprint is deterministic for identical inputs", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const store = new GraphValueStore(new InMemoryGraphValueStoreAdapter());
    const service = new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
    const node = plan.nodes.find((n) => n.id === "adder")!;
    const fp1 = service.computeFingerprint(plan.workflow, node, { a: 1, b: 2 }, {});
    const fp2 = service.computeFingerprint(plan.workflow, node, { a: 1, b: 2 }, {});
    expect(fp1).toBe(fp2);
  });

  it("computeFingerprint changes when inputs change", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const store = new GraphValueStore(new InMemoryGraphValueStoreAdapter());
    const service = new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
    const node = plan.nodes.find((n) => n.id === "adder")!;
    const fp1 = service.computeFingerprint(plan.workflow, node, { a: 1, b: 2 }, {});
    const fp2 = service.computeFingerprint(plan.workflow, node, { a: 1, b: 3 }, {});
    expect(fp1).not.toBe(fp2);
  });

  it("computeFingerprint is stable regardless of key ordering in inputs", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const store = new GraphValueStore(new InMemoryGraphValueStoreAdapter());
    const service = new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
    const node = plan.nodes.find((n) => n.id === "adder")!;
    const fp1 = service.computeFingerprint(plan.workflow, node, { a: 1, b: 2 }, {});
    const fp2 = service.computeFingerprint(plan.workflow, node, { b: 2, a: 1 }, {});
    expect(fp1).toBe(fp2);
  });

  it("readPinnedValue returns undefined when nothing is pinned", async () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const store = new GraphValueStore(new InMemoryGraphValueStoreAdapter());
    const service = new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
    const node = plan.nodes.find((n) => n.id === "adder")!;
    const result = await service.readPinnedValue(plan.workflow, node, {}, {});
    expect(result).toBeUndefined();
  });

  it("pinNode writes pinned values and readPinnedValue returns them", async () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const store = new GraphValueStore(new InMemoryGraphValueStoreAdapter());
    const service = new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
    const node = plan.nodes.find((n) => n.id === "adder")!;
    // Mark both nodes pinnable
    for (const n of plan.nodes) {
      (n.definition as any).graph = { metadata: { pinnable: { enabled: true, strategy: "manual", includeDependencies: true } } };
    }
    const fakeResult: GraphExecutionResult = {
      runId: "r1",
      workflowId: "linear-wf",
      status: "succeeded" as any,
      workflow: plan.workflow,
      inputs: { a: 1, b: 2 },
      outputs: {},
      nodeResults: {
        adder: {
          nodeId: "adder",
          status: "succeeded" as any,
          inputs: { a: 1, b: 2 },
          outputs: { sum: 3 },
          startedAt: new Date(),
          events: [],
        },
        multiplier: {
          nodeId: "multiplier",
          status: "succeeded" as any,
          inputs: { x: 3 },
          outputs: { product: 6 },
          startedAt: new Date(),
          events: [],
        },
      },
      events: [],
      startedAt: new Date(),
    };

    await service.pinNode({
      workflow: plan.workflow,
      plan,
      result: fakeResult,
      nodeId: "adder",
      includeDependencies: false,
    });

    const cached = await service.readPinnedValue(plan.workflow, node, { a: 1, b: 2 }, {});
    expect(cached?.pinned).toBe(true);
    expect(cached?.outputs.sum).toBe(3);
  });

  it("unpinNode removes the pinned value", async () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const store = new GraphValueStore(new InMemoryGraphValueStoreAdapter());
    const service = new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
    const node = plan.nodes.find((n) => n.id === "adder")!;
    for (const n of plan.nodes) {
      (n.definition as any).graph = { metadata: { pinnable: { enabled: true, strategy: "manual", includeDependencies: true } } };
    }
    const fakeResult: GraphExecutionResult = {
      runId: "r1",
      workflowId: "linear-wf",
      status: "succeeded" as any,
      workflow: plan.workflow,
      inputs: { a: 1, b: 2 },
      outputs: {},
      nodeResults: {
        adder: {
          nodeId: "adder",
          status: "succeeded" as any,
          inputs: { a: 1, b: 2 },
          outputs: { sum: 3 },
          startedAt: new Date(),
          events: [],
        },
      },
      events: [],
      startedAt: new Date(),
    };

    await service.pinNode({
      workflow: plan.workflow,
      plan,
      result: fakeResult,
      nodeId: "adder",
      includeDependencies: false,
    });

    const fingerprint = service.computeFingerprint(plan.workflow, node, { a: 1, b: 2 }, {});
    await service.unpinNode({
      workflow: plan.workflow,
      nodeId: "adder",
      fingerprint,
    });

    const cached = await service.readPinnedValue(plan.workflow, node, { a: 1, b: 2 }, {});
    expect(cached).toBeUndefined();
  });
});
