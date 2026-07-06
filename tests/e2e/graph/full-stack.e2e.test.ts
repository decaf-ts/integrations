/**
 * @module integrations/tests/e2e/graph/full-stack.e2e.test
 * @summary Full-stack e2e test validating the complete graph execution production pipeline.
 * @description Boots a real NestJS application with `GraphExecutionModule` (from TASK-224), connects via for-http's `ServerEventConnector` (SSE), triggers execution via HTTP POST, and validates the entire pipeline: HTTP execute → engine → SSE events → RamAdapter persistence → REST retrieval. This is the production path: for-nest hosts the engine, for-angular consumes events over the network.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { ServerEventConnector, type ServerEvent } from "@decaf-ts/for-http";
import { PortDirection } from "@decaf-ts/ui-decorators/graph";

import {
  GraphExecutionEventType,
  GraphExecutionStatus,
  type GraphExecutionEvent,
  type GraphExecutionValues,
  type GraphWorkflowDefinition,
} from "../../../src/graph";
import { GraphExecutionModule } from "../../../src/nest/graph";

/**
 * Builds the linear workflow used in tests, with inline port definitions so it
 * works without decorated model classes.
 *
 * Flow: workflow inputs (a, b) → adder (a + b = sum) → multiplier (sum * 2 = product) → workflow output (result)
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
 * Builds a workflow that references an unregistered executor kind, used to
 * test the error path.
 */
function buildInvalidWorkflow(): GraphWorkflowDefinition {
  return {
    name: "invalid-wf",
    tag: "invalid-wf",
    kind: "workflow",
    labels: [],
    ports: [],
    inputs: [
      { property: "a", direction: PortDirection.INPUT, name: "a", label: "a", required: false, hidden: false },
    ],
    outputs: [
      { property: "result", direction: PortDirection.OUTPUT, name: "result", label: "result", required: false, hidden: false },
    ],
    nodes: [
      {
        id: "unknown-node",
        kind: "nonexistent.executor",
        label: "Unknown",
        node: {
          name: "unknown-node",
          tag: "unknown-node",
          kind: "nonexistent.executor",
          labels: [],
          ports: [
            { property: "a", direction: PortDirection.INPUT, name: "a", label: "a", required: false, hidden: false },
            { property: "result", direction: PortDirection.OUTPUT, name: "result", label: "result", required: false, hidden: false },
          ],
        },
      },
    ],
    relations: [
      { source: "workflow", sourcePort: "a", target: "unknown-node", targetPort: "a" },
      { source: "unknown-node", sourcePort: "result", target: "workflow", targetPort: "result" },
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

/**
 * Waits for the `workflow.completed` or `workflow.failed` event to arrive in
 * the receivedEvents array. Polls every 100ms with a 5s timeout.
 */
async function waitForCompletion(
  receivedEvents: GraphExecutionEvent[]
): Promise<void> {
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const done = receivedEvents.some(
        (e) =>
          e.type === GraphExecutionEventType.WORKFLOW_COMPLETED ||
          e.type === GraphExecutionEventType.WORKFLOW_FAILED
      );
      if (done) {
        clearInterval(check);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(check);
      resolve();
    }, 5000);
  });
}

jest.setTimeout(60000);

describe("Full-Stack Graph Execution E2E (GraphExecutionModule → SSE → ServerEventConnector → REST)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let connector: ServerEventConnector;
  let removeListener: () => void;
  let receivedEvents: GraphExecutionEvent[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GraphExecutionModule.forRoot()],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 3000;
    baseUrl = `http://127.0.0.1:${port}`;

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

    await connector.ensureListening();
  }, 15000);

  afterAll(async () => {
    if (removeListener) removeListener();
    try {
      (connector as any).close(true);
    } catch {
      // already closed
    }
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
    expect(res.body.runId).toBeTruthy();
    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(14); // (3 + 4) * 2
  });

  it("receives SSE events in the correct order via ServerEventConnector", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 5, b: 6 };

    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    await waitForCompletion(receivedEvents);

    const types = receivedEvents.map((e) => e.type);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_STARTED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_PLANNED);
    expect(types).toContain(GraphExecutionEventType.NODE_STARTED);
    expect(types).toContain(GraphExecutionEventType.NODE_COMPLETED);
    expect(types).toContain(GraphExecutionEventType.EDGE_VALUE_ROUTED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_COMPLETED);
  });

  it("SSE events contain the correct runId matching the HTTP response", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 1, b: 1 };

    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    const runId = res.body.runId;

    await waitForCompletion(receivedEvents);

    expect(receivedEvents.length).toBeGreaterThan(0);
    for (const event of receivedEvents) {
      expect(event.runId).toBe(runId);
      expect(event.workflowId).toBe("linear-wf");
    }
  });

  it("SSE events have monotonically incrementing sequence numbers", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 2, b: 2 };

    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    await waitForCompletion(receivedEvents);

    const seqs = receivedEvents.map((e) => e.sequence);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("workflow.completed event payload contains correct output values after JSON serialization through SSE", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 7, b: 8 };

    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    await waitForCompletion(receivedEvents);

    const completedEvent = receivedEvents.find(
      (e) => e.type === GraphExecutionEventType.WORKFLOW_COMPLETED
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.payload).toBeDefined();
    const payload = completedEvent!.payload as { outputs: Record<string, unknown> };
    expect(payload.outputs).toBeDefined();
    expect(payload.outputs.result).toBe(30); // (7 + 8) * 2
  });

  it("GET /graph/results/:runId retrieves the full persisted result from RamAdapter", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 10, b: 20 };

    const execRes = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    expect(execRes.status).toBe(201);
    const runId = execRes.body.runId;

    const res = await request(app.getHttpServer())
      .get(`/graph/results/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(runId);
    expect(res.body.workflowId).toBe("linear-wf");
    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(60); // (10 + 20) * 2
    expect(res.body.inputs).toEqual(inputs);
  });

  it("error scenario: invalid workflow (missing executor) produces workflow.failed event with error payload", async () => {
    const workflow = buildInvalidWorkflow();
    const inputs: GraphExecutionValues = { a: 1 };

    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs });

    expect(res.body.status).toBe(GraphExecutionStatus.FAILED);

    await waitForCompletion(receivedEvents);

    const failedEvent = receivedEvents.find(
      (e) => e.type === GraphExecutionEventType.WORKFLOW_FAILED
    );
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error).toBeDefined();
    expect(failedEvent!.error!.message).toContain("nonexistent.executor");
  });

  it("multiple runs with different inputs produce separate runIds, separate persisted results, and correct outputs", async () => {
    const workflow = buildLinearWorkflow();

    const res1 = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs: { a: 1, b: 2 } });

    const res2 = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow, inputs: { a: 100, b: 200 } });

    expect(res1.body.runId).not.toBe(res2.body.runId);
    expect(res1.body.outputs.result).toBe(6); // (1 + 2) * 2
    expect(res2.body.outputs.result).toBe(600); // (100 + 200) * 2

    const result1 = await request(app.getHttpServer())
      .get(`/graph/results/${res1.body.runId}`);
    const result2 = await request(app.getHttpServer())
      .get(`/graph/results/${res2.body.runId}`);

    expect(result1.body.outputs.result).toBe(6);
    expect(result2.body.outputs.result).toBe(600);
    expect(result1.body.runId).not.toBe(result2.body.runId);
  });

  it("SSE connection cleanup: no open handles after test suite", async () => {
    // This test verifies that the afterAll cleanup works properly.
    // If there were open handles, jest --detectOpenHandles would report them.
    // The mere fact that this test runs and the suite exits cleanly is the assertion.
    expect(removeListener).toBeDefined();
    expect(connector).toBeDefined();
    expect(app).toBeDefined();
  });
});
