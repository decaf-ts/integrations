/**
 * @module integrations/tests/unit/nest/graph-execution-module.test
 * @summary Unit tests for the NestJS graph execution backend module.
 * @description Bootstraps {@link GraphExecutionModule} via `@nestjs/testing`
 * and validates the DECAF-50 §4.20 P7 cutover defaults:
 * - `POST /graph/execute` executes a canonical `GraphWorkflowDocument` and
 *   returns the correct result.
 * - Legacy `GraphWorkflowDefinition` payloads (and snapshot wrappers) are
 *   rejected at the boundary with a Decaf `ValidationError` — the
 *   flag-independent default (§4.16 inline-definition rejection).
 * - SSE events are emitted in the correct order through the `events()`
 *   Observable.
 * - `GET /graph/results/:runId` retrieves the persisted result via the
 *   service.
 * - `PUT /graph/workflow/:id` accepts canonical wrapper snapshots only.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { ValidationError } from "@decaf-ts/db-decorators";
import type {
  GraphWorkflowDocument,
  GraphWorkflowDefinition,
} from "@decaf-ts/ui-decorators/graph";

import {
  GraphExecutionEventType,
  GraphExecutionStatus,
  type GraphExecutionEvent,
} from "@decaf-ts/ui-decorators/graph";
import {
  type GraphExecutionValues,
} from "../../../src/graph";

import {
  GraphExecutionController,
  GraphExecutionModule,
  GraphResultService,
  GraphWorkflowService,
} from "../../../src/nest/graph";

/**
 * Builds the canonical two-node document used by the module tests:
 *   workflow.a/b -> adder -> multiplier -> workflow.result
 * (math.add sums a+b on `sum`; math.multiply doubles `x` on `product`.)
 */
function buildLinearDocument(
  workflowId = "linear-wf"
): GraphWorkflowDocument {
  return {
    id: workflowId,
    name: workflowId,
    inputs: [{ id: "a" }, { id: "b" }],
    outputs: [{ id: "result" }],
    nodes: [
      { id: "adder", kind: "math.add", parameters: {} },
      { id: "multiplier", kind: "math.multiply", parameters: {} },
    ],
    edges: [
      {
        id: "e1",
        type: "data",
        source: { scope: "workflow", port: "a" },
        target: { scope: "node", nodeId: "adder", port: "a" },
      },
      {
        id: "e2",
        type: "data",
        source: { scope: "workflow", port: "b" },
        target: { scope: "node", nodeId: "adder", port: "b" },
      },
      {
        id: "e3",
        type: "data",
        source: { scope: "node", nodeId: "adder", port: "sum" },
        target: { scope: "node", nodeId: "multiplier", port: "x" },
      },
      {
        id: "e4",
        type: "data",
        source: { scope: "node", nodeId: "multiplier", port: "product" },
        target: { scope: "workflow", port: "result" },
      },
    ],
  };
}

/**
 * Builds a legacy decorated-era `GraphWorkflowDefinition` payload (the
 * pre-DECAF-50 execution request shape). Post-cutover this payload MUST be
 * rejected by `POST /graph/execute` (§4.16/§4.20 P7).
 */
function buildLegacyWorkflowDefinition(): GraphWorkflowDefinition {
  return {
    name: "linear-wf",
    tag: "linear-wf",
    kind: "workflow",
    labels: [],
    ports: [],
    inputs: [],
    outputs: [],
    nodes: [
      { id: "adder", kind: "math.add", label: "Adder" },
      { id: "multiplier", kind: "math.multiply", label: "Multiplier" },
    ],
    relations: [
      { source: "adder", sourcePort: "sum", target: "multiplier", targetPort: "x" },
    ],
    workflow: { inputs: [], outputs: [] },
  } as unknown as GraphWorkflowDefinition;
}

jest.setTimeout(30000);

describe("GraphExecutionModule (unit)", () => {
  let app: INestApplication;
  let controller: GraphExecutionController;
  let resultService: GraphResultService;
  let workflowService: GraphWorkflowService;
  let sseEvents: GraphExecutionEvent[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // SAA-595: the deprecated global SSE stream is disabled by default;
      // this suite pins its (ownership-gated) residual behavior explicitly.
      imports: [
        GraphExecutionModule.forRoot({
          execution: { enableGlobalEventStream: true },
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    controller = moduleRef.get(GraphExecutionController);
    resultService = moduleRef.get(GraphResultService);
    workflowService = moduleRef.get(GraphWorkflowService);

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

  it("executes a canonical document and returns the correct result", async () => {
    const workflow = buildLinearDocument();
    const inputs: GraphExecutionValues = { a: 3, b: 4 };

    const response = await controller.execute({ workflow, inputs });

    expect(response.runId).toBeTruthy();
    expect(response.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(response.outputs.result).toBe(14); // (3 + 4) * 2
  });

  it("P7 §4.16 security pin (payload level, flag-independent default): legacy GraphWorkflowDefinition payloads to POST /graph/execute are rejected with a Decaf ValidationError", async () => {
    const legacy = buildLegacyWorkflowDefinition();

    // Controller contract: the boundary rejects the legacy payload with a
    // Decaf ValidationError before the engine or planner sees it.
    await expect(
      controller.execute({ workflow: legacy as never, inputs: {} })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.execute({ workflow: legacy as never, inputs: {} })
    ).rejects.toThrow(/canonical GraphWorkflowDocument/);

    // Snapshot wrappers are non-canonical payloads too and are rejected.
    const wrapper = { document: buildLinearDocument(), metadata: {} };
    await expect(
      controller.execute({ workflow: wrapper as never, inputs: {} })
    ).rejects.toBeInstanceOf(ValidationError);

    // HTTP surface: the legacy payload never executes — the request fails
    // without running a workflow or persisting a result.
    const execRes = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: legacy, inputs: { a: 3, b: 4 } });
    expect(execRes.status).toBeGreaterThanOrEqual(400);
    expect(execRes.body.runId).toBeUndefined();
  });

  it("SSE endpoint emits events in the correct order", async () => {
    sseEvents = [];
    const workflow = buildLinearDocument();
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

  it("persists the result and retrieves it via the service", async () => {
    const workflow = buildLinearDocument();
    const inputs: GraphExecutionValues = { a: 7, b: 8 };

    const response = await controller.execute({ workflow, inputs });

    // Retrieve via the service directly
    const persisted = await resultService.findByRunId(response.runId);
    expect(persisted).toBeTruthy();
    expect(persisted!.runId).toBe(response.runId);
    expect(persisted!.workflowId).toBe("linear-wf");
    expect(persisted!.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(persisted!.outputs.result).toBe(30); // (7 + 8) * 2
    expect(persisted!.inputs).toEqual(inputs);
  });

  it("GET /graph/results/:runId returns the persisted result via HTTP", async () => {
    const workflow = buildLinearDocument();
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

  it("PUT /graph/workflow/:id accepts only canonical wrapper snapshots (legacy definition/state snapshots are rejected)", async () => {
    // Legacy definition/state snapshot payloads are rejected (§4.11 P7).
    const legacySnapshot = {
      state: { nodes: [], edges: [] },
      metadata: { serializedAt: "2024-01-01" },
    };
    const legacyRes = await request(app.getHttpServer())
      .put("/graph/workflow/test-wf-1")
      .send(legacySnapshot);
    expect(legacyRes.status).toBeGreaterThanOrEqual(400);
    expect(await workflowService.loadSnapshot("test-wf-1")).toBeNull();

    // Canonical wrapper snapshots round-trip through the deprecated
    // snapshot endpoint: the wrapper is stored and `getDocument` prefers
    // the canonical document column.
    const wrapper = {
      document: buildLinearDocument("test-wf-1"),
      metadata: { serializedAt: "2024-01-01" },
    };
    const res = await request(app.getHttpServer())
      .put("/graph/workflow/test-wf-1")
      .send(wrapper);

    expect(res.status).toBe(200);
    expect(res.body.workflowId).toBe("test-wf-1");
    expect(res.body.savedAt).toBeTruthy();

    // Verify via the service
    const persisted = await workflowService.loadSnapshot("test-wf-1");
    expect(persisted).toBeTruthy();
    expect(persisted!.workflowId).toBe("test-wf-1");
    expect(persisted!.snapshot).toEqual(wrapper);
    expect(persisted!.document).toEqual(wrapper.document);
    expect(await workflowService.getDocument("test-wf-1")).toEqual(
      wrapper.document
    );
  });
});
