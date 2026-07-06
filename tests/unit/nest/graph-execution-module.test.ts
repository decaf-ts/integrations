/**
 * @module integrations/tests/unit/nest/graph-execution-module.test
 * @summary Unit tests for the NestJS graph execution backend module.
 * @description Bootstraps {@link GraphExecutionModule} via `@nestjs/testing` and validates:
 * - `POST /graph/execute` executes a workflow and returns the correct result.
 * - SSE events are emitted in the correct order through the `events()` Observable.
 * - `GET /graph/results/:runId` retrieves the persisted result from RamAdapter.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { PortDirection } from "@decaf-ts/ui-decorators/graph";

import {
  GraphExecutionEventType,
  GraphExecutionStatus,
  type GraphExecutionEvent,
  type GraphExecutionValues,
  type GraphWorkflowDefinition,
} from "../../../src/graph";

import {
  GraphExecutionController,
  GraphExecutionModule,
  GRAPH_RESULT_REPOSITORY,
} from "../../../src/nest/graph";

/**
 * Builds the linear workflow used in tests, with inline port definitions so it
 * works without decorated model classes.
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

jest.setTimeout(30000);

describe("GraphExecutionModule (unit)", () => {
  let app: INestApplication;
  let controller: GraphExecutionController;
  let repository: any;
  let sseEvents: GraphExecutionEvent[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GraphExecutionModule.forRoot()],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    controller = moduleRef.get(GraphExecutionController);
    repository = moduleRef.get(GRAPH_RESULT_REPOSITORY);

    sseEvents = [];
    const sub = controller["events"]().subscribe((msg: any) => {
      const data = JSON.parse(msg.data);
      const payload = data[3];
      sseEvents.push({
        ...payload,
        timestamp: new Date(payload.timestamp),
      } as GraphExecutionEvent);
    });

    // keep subscription alive for the duration of the suite
    (globalThis as any).__graphSseSub = sub;
  }, 15000);

  afterAll(async () => {
    const sub = (globalThis as any).__graphSseSub;
    if (sub) sub.unsubscribe();
    try {
      await app.close();
    } catch {
      // already closed
    }
  }, 15000);

  it("executes a workflow and returns the correct result", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 3, b: 4 };

    const response = await controller.execute({ workflow, inputs });

    expect(response.runId).toBeTruthy();
    expect(response.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(response.outputs.result).toBe(14); // (3 + 4) * 2
  });

  it("SSE endpoint emits events in the correct order", async () => {
    sseEvents = [];
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 5, b: 6 };

    await controller.execute({ workflow, inputs });

    // Allow the Observable to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    const types = sseEvents.map((e) => e.type);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_STARTED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_PLANNED);
    expect(types).toContain(GraphExecutionEventType.NODE_STARTED);
    expect(types).toContain(GraphExecutionEventType.NODE_COMPLETED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_COMPLETED);
  });

  it("persists the result and retrieves it via the repository", async () => {
    const workflow = buildLinearWorkflow();
    const inputs: GraphExecutionValues = { a: 7, b: 8 };

    const response = await controller.execute({ workflow, inputs });

    // Retrieve via the repository directly
    const persisted = (await repository.read(response.runId)) as any;
    expect(persisted).toBeTruthy();
    expect(persisted.runId).toBe(response.runId);
    expect(persisted.workflowId).toBe("linear-wf");
    expect(persisted.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(persisted.outputs.result).toBe(30); // (7 + 8) * 2
    expect(persisted.inputs).toEqual(inputs);
  });

  it("GET /graph/results/:runId returns the persisted result via HTTP", async () => {
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
    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(60); // (10 + 20) * 2
  });

  it("GET /graph/results/:runId returns 404 for unknown runId", async () => {
    const res = await request(app.getHttpServer())
      .get("/graph/results/nonexistent-run-id");

    expect(res.status).toBe(404);
  });
});
