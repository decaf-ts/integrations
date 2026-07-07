/**
 * @module integrations/tests/unit/graph/GraphExecutionEventFactory.test
 * @summary Unit tests for the graph execution event factory.
 */
import { GraphExecutionEventFactory } from "../../../src/graph/engine/events";
import { GraphExecutionEventType } from "../../../src/graph/shared/constants";

describe("GraphExecutionEventFactory", () => {
  it("creates events with unique ids, incrementing sequence, and timestamp", () => {
    const factory = new GraphExecutionEventFactory();
    const event1 = factory.create({
      runId: "r1",
      workflowId: "w1",
      type: GraphExecutionEventType.NODE_STARTED,
      path: [],
    });
    const event2 = factory.create({
      runId: "r1",
      workflowId: "w1",
      type: GraphExecutionEventType.NODE_COMPLETED,
      path: [],
    });

    expect(event1.id).not.toBe(event2.id);
    expect(event1.sequence).toBe(1);
    expect(event2.sequence).toBe(2);
    expect(event1.timestamp).toBeInstanceOf(Date);
    expect(event2.timestamp).toBeInstanceOf(Date);
  });

  it("preserves provided fields", () => {
    const factory = new GraphExecutionEventFactory();
    const event = factory.create({
      runId: "r1",
      workflowId: "w1",
      type: GraphExecutionEventType.NODE_OUTPUT,
      nodeId: "node1",
      path: ["root", "node1"],
      payload: { data: 42 },
    });

    expect(event.runId).toBe("r1");
    expect(event.workflowId).toBe("w1");
    expect(event.nodeId).toBe("node1");
    expect(event.path).toEqual(["root", "node1"]);
    expect(event.payload).toEqual({ data: 42 });
  });
});
