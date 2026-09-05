/**
 * @module integrations/tests/e2e/graph/graph-execution.e2e.test
 * @summary E2E test validating the deprecated global SSE stream pipeline.
 * @description Boots the production {@link GraphExecutionModule} with the
 * deprecated global `GET /graph/events` SSE stream explicitly re-enabled
 * (`execution: { enableGlobalEventStream: true }`, SAA-595 F2: the stream
 * is disabled unless opted in), connects via for-http's
 * {@link ServerEventConnector}, triggers execution of a canonical workflow
 * document via HTTP POST, and validates that events flow correctly from
 * engine → SSE → client in the `["graph", type, runId, envelope]` wire
 * format for-http consumers expect. The residual stream itself (and its
 * ServerEventConnector wire format) is what is under test here; everything
 * else uses the run-scoped transport (see `full-stack.e2e.test.ts`).
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { ServerEventConnector, type ServerEvent } from "@decaf-ts/for-http";

import {
  GraphExecutionEventType,
  GraphExecutionStatus,
  type GraphExecutionEvent,
} from "@decaf-ts/ui-decorators/graph";
import { GraphExecutionModule } from "../../../src/nest/graph";
import { linearDocument } from "../../unit/graph/fixtures";
import { TestRequestContextModule } from "../../unit/nest/graphRunTestSupport";

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

describe("Graph Execution E2E (for-nest → opt-in global SSE → for-http ServerEventConnector)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let connector: ServerEventConnector;
  let removeListener: () => void;
  let receivedEvents: GraphExecutionEvent[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestRequestContextModule,
        GraphExecutionModule.forRoot({
          // SAA-595 F2: the global stream is opt-in only. This suite exists
          // to cover the residual stream itself, so the opt-in is explicit.
          execution: { enableGlobalEventStream: true },
          runs: { auth: "optional", allowAnonymousAccess: true },
          workflows: { auth: "optional", allowAnonymousAccess: true },
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
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

  it("executes a canonical workflow via HTTP POST and returns the correct result", async () => {
    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: linearDocument(), inputs: { a: 3, b: 4 } });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(14); // (3+4) * 2
    expect(res.body.runId).toBeTruthy();
  });

  it("receives graph execution events via SSE in the correct order", async () => {
    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: linearDocument(), inputs: { a: 5, b: 6 } });

    expect(res.status).toBe(201);

    await waitForCompletion(receivedEvents);

    expect(receivedEvents.length).toBeGreaterThanOrEqual(5);

    const types = receivedEvents.map((e) => e.type);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_STARTED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_PLANNED);
    expect(types).toContain(GraphExecutionEventType.NODE_STARTED);
    expect(types).toContain(GraphExecutionEventType.NODE_COMPLETED);
    expect(types).toContain(GraphExecutionEventType.WORKFLOW_COMPLETED);
  });

  it("SSE events contain correct runId and workflowId", async () => {
    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: linearDocument(), inputs: { a: 1, b: 1 } });

    const runId = res.body.runId;

    await waitForCompletion(receivedEvents);

    for (const event of receivedEvents) {
      expect(event.runId).toBe(runId);
      expect(event.workflowId).toBe("linear-wf");
    }
  });

  it("SSE events have incrementing sequence numbers", async () => {
    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: linearDocument(), inputs: { a: 2, b: 2 } });

    await waitForCompletion(receivedEvents);

    const seqs = receivedEvents.map((e) => e.sequence);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("preserves event payloads through the SSE pipeline", async () => {
    receivedEvents = [];

    await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: linearDocument(), inputs: { a: 7, b: 8 } });

    await waitForCompletion(receivedEvents);

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
    receivedEvents = [];

    const res = await request(app.getHttpServer())
      .post("/graph/execute")
      .send({ workflow: linearDocument(), inputs: { a: 10, b: 20 } });

    expect(res.body.status).toBe(GraphExecutionStatus.SUCCEEDED);
    expect(res.body.outputs.result).toBe(60); // (10+20) * 2

    await waitForCompletion(receivedEvents);

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
