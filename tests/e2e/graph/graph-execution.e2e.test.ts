/**
 * @module integrations/tests/e2e/graph/graph-execution.e2e.test
 * @summary E2E test validating the full graph execution production pipeline.
 * @description Starts a NestJS app hosting the graph execution engine, connects via for-http's ServerEventConnector (SSE), triggers execution via HTTP POST, and validates that events flow correctly from engine → SSE → client. This mirrors the real production path: for-nest hosts the engine, for-angular consumes events over the network.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Module } from "@nestjs/common";
import request from "supertest";

import { ServerEventConnector, type ServerEvent } from "@decaf-ts/for-http";

import {
  GraphExecutionEventType,
  GraphExecutionStatus,
  type GraphExecutionEvent,
  type GraphExecutionValues,
  type GraphWorkflowDefinition,
} from "../../../src/graph";
import { PortDirection } from "@decaf-ts/ui-decorators/graph";

import { GraphExecutionController } from "./GraphExecutionController";

/**
 * NestJS module wiring the graph execution controller.
 */
@Module({
  controllers: [GraphExecutionController],
})
class GraphExecutionTestModule {}

/**
 * Builds the linear workflow used in unit tests, but with inline port
 * definitions so it works without decorated model classes.
 */
function buildLinearWorkflow(): GraphWorkflowDefinition {
  return {
    name: "linear-wf",
    tag: "linear-wf",
    kind: "workflow",
    labels: [],
    ports: [],
    inputs: [
      { property: "a", direction: PortDirection.INPUT, name: "a", label: "a", required: false, hidden: false },
      { property: "b", direction: PortDirection.INPUT, name: "b", label: "b", required: false, hidden: false },
    ],
    outputs: [
      { property: "result", direction: PortDirection.OUTPUT, name: "result", label: "result", required: false, hidden: false },
    ],
    nodes: [
      {
        id: "adder",
        kind: "math.add",
        label: "Adder",
        node: {
          name: "adder",
          tag: "adder",
          kind: "math.add",
          labels: [],
          ports: [
            { property: "a", direction: PortDirection.INPUT, name: "a", label: "a", required: false, hidden: false },
            { property: "b", direction: PortDirection.INPUT, name: "b", label: "b", required: false, hidden: false },
            { property: "sum", direction: PortDirection.OUTPUT, name: "sum", label: "sum", required: false, hidden: false },
          ],
        },
      },
      {
        id: "multiplier",
        kind: "math.multiply",
        label: "Multiplier",
        node: {
          name: "multiplier",
          tag: "multiplier",
          kind: "math.multiply",
          labels: [],
          ports: [
            { property: "x", direction: PortDirection.INPUT, name: "x", label: "x", required: false, hidden: false },
            { property: "product", direction: PortDirection.OUTPUT, name: "product", label: "product", required: false, hidden: false },
          ],
        },
      },
    ],
    relations: [
      { source: "workflow", sourcePort: "a", target: "adder", targetPort: "a" },
      { source: "workflow", sourcePort: "b", target: "adder", targetPort: "b" },
      { source: "adder", sourcePort: "sum", target: "multiplier", targetPort: "x" },
      { source: "multiplier", sourcePort: "product", target: "workflow", targetPort: "result" },
    ],
    workflow: { inputs: [], outputs: [] },
  };
}

/**
 * Extracts a GraphExecutionEvent from the SSE-wrapped ServerEvent format.
 */
function unwrapGraphEvent(sseEvent: ServerEvent<any>): GraphExecutionEvent {
  const payload = sseEvent[3] as GraphExecutionEvent;
  return {
    ...payload,
    timestamp: new Date(payload.timestamp),
  } as GraphExecutionEvent;
}

jest.setTimeout(60000);

describe("Graph Execution E2E (for-nest → SSE → for-http)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let connector: ServerEventConnector;
  let removeListener: () => void;
  let receivedEvents: GraphExecutionEvent[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GraphExecutionTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 3000;
    baseUrl = `http://127.0.0.1:${port}`;

    console.log(`[e2e] NestJS app listening on ${baseUrl}`);

    receivedEvents = [];
    connector = ServerEventConnector.open(`${baseUrl}/graph/events`);
    removeListener = connector.addListener({
      onEvent: (sseEvent: ServerEvent<any>) => {
        const graphEvent = unwrapGraphEvent(sseEvent);
        receivedEvents.push(graphEvent);
      },
      onError: (err: unknown) => {
        console.error("[e2e] SSE error:", err);
      },
    });

    console.log("[e2e] Waiting for SSE connection to be ready...");
    await connector.ensureListening();
    console.log("[e2e] SSE connection ready");
  }, 15000);

  afterAll(async () => {
    // Remove listener first — this triggers auto-close when count hits 0
    if (removeListener) removeListener();
    // Force-close the SSE connector to abort the HTTP connection
    try {
      (connector as any).close(true);
    } catch {
      // already closed
    }
    // Close the NestJS app
    try {
      await app.close();
    } catch {
      // app may already be closed
    }
  }, 30000);

  it("executes a workflow via HTTP POST and returns the correct result", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 3, b: 4 };

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(14); // (3+4) * 2
    expect(res.body.runId).toBeTruthy();
  });

  it("receives graph execution events via SSE in the correct order", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 5, b: 6 };

    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    expect(res.status).toBe(201);

    // Wait for SSE events to arrive
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const hasCompleted = receivedEvents.some(
          (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
        );
        if (hasCompleted) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    expect(receivedEvents.length).toBeGreaterThanOrEqual(5);

    const types = receivedEvents.map((e) => e.type);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_STARTED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_PLANNED);
    expect(types).toContain(GraphExecutionEventType.NODE_STARTED);
    expect(types).toContain(GraphExecutionEventType.NODE_COMPLETED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_COMPLETED);
  });

  it("SSE events contain correct runId and workflowId", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 1, b: 1 };

    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    const runId = res.body.runId;

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const hasCompleted = receivedEvents.some(
          (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
        );
        if (hasCompleted) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    for (const event of receivedEvents) {
      expect(event.runId).toBe(runId);
      expect(event.workflowId).toBe("linear-wf");
    }
  });

  it("SSE events have incrementing sequence numbers", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 2, b: 2 };

    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const hasCompleted = receivedEvents.some(
          (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
        );
        if (hasCompleted) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    const seqs = receivedEvents.map((e) => e.sequence);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("preserves event payloads through the SSE pipeline", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 7, b: 8 };

    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const hasCompleted = receivedEvents.some(
          (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
        );
        if (hasCompleted) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    // The workflow.completed event should contain the outputs payload
    const completedEvent = receivedEvents.find(
      (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.payload).toBeDefined();
    const payload = completedEvent!.payload as { outputs: Record<string, unknown> };
    expect(payload.outputs).toBeDefined();
    expect(payload.outputs.result).toBe(30); // (7+8) * 2
  });

  it("validates full pipeline: HTTP execute → engine → SSE → client receives all event types", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 10, b: 20 };

    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(60); // (10+20) * 2

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const hasCompleted = receivedEvents.some(
          (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
        );
        if (hasCompleted) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    const types = receivedEvents.map((e) => e.type);
    const expectedTypes = [
      GraphExecutionEventType.WORKFLOW_STARTED,
      GraphExecutionEventType.WORKFLOW_PLANNED,
      GraphExecutionEventType.NODE_STARTED,
      GraphExecutionEventType.NODE_COMPLETED,
      GraphExecutionEventType.EDGE_VALUE_ROUTED,
      GraphExecutionEventType.WORKFLOW_COMPLETED,
    ];

    for (const expected of expectedTypes) {
      expect(types).toContain(expected);
    }

    // Verify node events reference the correct node ids
    const nodeStartedEvents = receivedEvents.filter(
      (e) => e.type === GraphExecutionEventType.NODE_STARTED
    );
    const nodeIds = nodeStartedEvents.map((e) => e.nodeId).sort();
    expect(nodeIds).toEqual(["adder", "multiplier"]);
  });
});
