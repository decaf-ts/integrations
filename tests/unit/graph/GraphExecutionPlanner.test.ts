/**
 * @module integrations/tests/unit/graph/GraphExecutionPlanner.test
 * @summary Unit tests for the graph execution planner (Kahn's algorithm).
 */
import { GraphCycleError } from "../../../src/graph/engine/errors/GraphCycleError";
import { GraphTopologyError } from "../../../src/graph/engine/errors/GraphTopologyError";
import { GraphExecutionPlanner } from "../../../src/graph/engine/planning/GraphExecutionPlanner";

import { cyclicWorkflow, linearWorkflow, workflowNode } from "./fixtures";

describe("GraphExecutionPlanner", () => {
  it("plans a linear workflow into ordered topological layers", () => {
    const planner = new GraphExecutionPlanner();
    const plan = planner.plan(linearWorkflow());

    expect(plan.workflowId).toBe("linear-wf");
    expect(plan.nodes).toHaveLength(2);
    expect(plan.edges.length).toBe(4);
    expect(plan.layers.length).toBeGreaterThanOrEqual(2);

    // adder has no executable-node dependencies -> layer 0
    const layer0 = plan.layers[0];
    expect(layer0.nodes.map((n) => n.id)).toContain("adder");

    // multiplier depends on adder -> layer 1
    const layer1 = plan.layers[1];
    expect(layer1.nodes.map((n) => n.id)).toContain("multiplier");
  });

  it("resolves input and output ports from node definitions", () => {
    const planner = new GraphExecutionPlanner();
    const plan = planner.plan(linearWorkflow());

    const adder = plan.nodes.find((n) => n.id === "adder")!;
    expect(adder.inputPorts).toEqual(["a", "b"]);
    expect(adder.outputPorts).toEqual(["sum"]);
  });

  it("builds incoming and outgoing edge maps", () => {
    const planner = new GraphExecutionPlanner();
    const plan = planner.plan(linearWorkflow());

    const incoming = plan.incomingByNode.get("adder") ?? [];
    expect(incoming.length).toBe(2);

    const outgoing = plan.outgoingByNode.get("adder") ?? [];
    expect(outgoing.length).toBe(1);
    expect(outgoing[0].targetNodeId).toBe("multiplier");
  });

  it("throws GraphCycleError for cyclic workflows", () => {
    const planner = new GraphExecutionPlanner();
    expect(() => planner.plan(cyclicWorkflow())).toThrow(GraphCycleError);
  });

  it("throws GraphTopologyError for duplicate node ids", () => {
    const planner = new GraphExecutionPlanner();
    const wf = linearWorkflow();
    wf.nodes = [
      workflowNode("adder", "math.add"),
      workflowNode("adder", "math.add"),
    ];
    expect(() => planner.plan(wf)).toThrow(GraphTopologyError);
  });

  it("assigns incremental layer indices", () => {
    const planner = new GraphExecutionPlanner();
    const plan = planner.plan(linearWorkflow());
    plan.layers.forEach((layer, i) => {
      expect(layer.index).toBe(i);
    });
  });
});
