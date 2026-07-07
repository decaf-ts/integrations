/**
 * @module integrations/tests/unit/graph/GraphTopology.test
 * @summary Unit tests for the graph topology helpers.
 */
import { GRAPH_WORKFLOW_BOUNDARY } from "../../../src/graph/engine/constants";
import { GraphExecutionPlanner } from "../../../src/graph/engine/planning/GraphExecutionPlanner";
import { GraphTopology } from "../../../src/graph/engine/planning/GraphTopology";

import { linearWorkflow } from "./fixtures";

describe("GraphTopology", () => {
  it("isBoundary identifies the workflow boundary id", () => {
    expect(GraphTopology.isBoundary(GRAPH_WORKFLOW_BOUNDARY)).toBe(true);
    expect(GraphTopology.isBoundary("n1")).toBe(false);
  });

  it("upstreamNodes returns dependencies excluding the boundary by default", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const upstream = GraphTopology.upstreamNodes("multiplier", plan.incomingByNode);
    expect(upstream.has("adder")).toBe(true);
    expect(upstream.has(GRAPH_WORKFLOW_BOUNDARY)).toBe(false);
  });

  it("upstreamNodes includes boundary when includeBoundary is true", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const upstream = GraphTopology.upstreamNodes("adder", plan.incomingByNode, true);
    expect(upstream.has(GRAPH_WORKFLOW_BOUNDARY)).toBe(true);
  });

  it("downstreamNodes returns dependents excluding the boundary by default", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const downstream = GraphTopology.downstreamNodes("adder", plan.outgoingByNode);
    expect(downstream.has("multiplier")).toBe(true);
    expect(downstream.has(GRAPH_WORKFLOW_BOUNDARY)).toBe(false);
  });

  it("downstreamNodes includes boundary when includeBoundary is true", () => {
    const plan = new GraphExecutionPlanner().plan(linearWorkflow());
    const downstream = GraphTopology.downstreamNodes("multiplier", plan.outgoingByNode, true);
    expect(downstream.has(GRAPH_WORKFLOW_BOUNDARY)).toBe(true);
  });
});
