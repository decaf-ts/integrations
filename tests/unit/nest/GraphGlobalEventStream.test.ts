/**
 * @module integrations/tests/unit/nest/GraphGlobalEventStream
 * @summary SAA-595 F2 regression tests: deprecated global SSE stream.
 * @description Pins the hardened behaviour of the deprecated global
 * `GET /graph/events` SSE stream:
 * - default configuration: the stream is disabled and answers `404` with a
 *   pointer at the run-scoped `GET /graph/runs/{runId}/events` transport;
 * - explicit opt-in (`execution.enableGlobalEventStream: true`): the stream
 *   is ownership-gated at emit — a non-owner connected for the whole
 *   lifetime of another user's run receives no events for it, while the
 *   owner receives their own run's events.
 *
 * The opt-in app uses the `test.gate` executor (see `graphRunTestSupport`)
 * so both subscribers are provably connected while the run is live: the
 * denial is exercised against in-flight events, not missed timing.
 */
import * as http from "node:http";
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import request from "supertest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  GraphExecutionEventType,
  isGraphRunTerminalEventType,
  type GraphRunEventEnvelope,
} from "@decaf-ts/ui-decorators/graph";
import {
  GraphNodeCatalogue,
} from "../../../src/graph";
import { GraphExecutionModule } from "../../../src/nest/graph";
import {
  GateCenter,
  TEST_USER_HEADER,
  TestRequestContextModule,
  gateDocument,
  gateKey,
} from "./graphRunTestSupport";

jest.setTimeout(60000);

/** One parsed `["graph", type, runId, envelope]` frame from the global stream. */
interface GlobalStreamFrame {
  type: string;
  runId: string;
  envelope: GraphRunEventEnvelope;
}

/**
 * Live raw-HTTP collector for the deprecated global stream: resolves
 * `ready` once the response headers arrive, accumulates parsed frames, and
 * never auto-completes (the global stream has no terminal completion).
 */
function openGlobalEventStream(
  port: number,
  user?: string
): {
  ready: Promise<number>;
  frames: GlobalStreamFrame[];
  close: () => void;
  waitFor: (
    predicate: (frame: GlobalStreamFrame) => boolean,
    timeoutMs?: number
  ) => Promise<GlobalStreamFrame>;
} {
  const frames: GlobalStreamFrame[] = [];
  let readyResolve!: (status: number) => void;
  const ready = new Promise<number>((resolve) => {
    readyResolve = resolve;
  });
  let responseRef: http.IncomingMessage | undefined;

  const req = http.request(
    {
      host: "127.0.0.1",
      port,
      path: "/graph/events",
      method: "GET",
      agent: false,
      headers: {
        accept: "text/event-stream",
        ...(user ? { [TEST_USER_HEADER]: user } : {}),
      },
    },
    (res) => {
      readyResolve(res.statusCode ?? 0);
      if ((res.statusCode ?? 0) !== 200) return;
      responseRef = res;
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice("data: ".length)) as unknown;
              if (
                Array.isArray(parsed) &&
                parsed.length >= 4 &&
                typeof parsed[1] === "string" &&
                typeof parsed[2] === "string" &&
                typeof parsed[3] === "object"
              ) {
                frames.push({
                  type: parsed[1],
                  runId: parsed[2],
                  envelope: parsed[3] as GraphRunEventEnvelope,
                });
              }
            } catch {
              // non-JSON keep-alive frames are ignored
            }
          }
          index = buffer.indexOf("\n\n");
        }
      });
    }
  );
  req.on("error", () => readyResolve(0));
  req.end();

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  return {
    ready,
    frames,
    close: () => {
      req.destroy();
      responseRef?.destroy();
    },
    waitFor: async (predicate, timeoutMs = 10000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = frames.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for a matching global-stream frame after ${timeoutMs}ms; received ${frames.length} frame(s): ${frames
              .map((frame) => `${frame.envelope.sequence}:${frame.type}`)
              .join(", ")}`
          );
        }
        await delay(10);
      }
    },
  };
}

describe("GraphGlobalEventStream (SAA-595 F2 regression)", () => {
  describe("default configuration", () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [GraphExecutionModule.forRoot()],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      await app.listen(0);
    });

    afterAll(async () => {
      try {
        await app.close();
      } catch {
        // already closed
      }
    });

    it("1. GET /graph/events answers 404 with a pointer at the run-scoped transport", async () => {
      const res = await request(app.getHttpServer()).get("/graph/events");

      expect(res.status).toBe(404);
      expect(res.body.message).toContain("global graph event stream is disabled");
      expect(res.body.message).toContain("GET /graph/runs/{runId}/events");
    });
  });

  describe("explicit opt-in (enableGlobalEventStream: true)", () => {
    let app: INestApplication;
    let port: number;
    const gates = new GateCenter();
    let aliceStream: ReturnType<typeof openGlobalEventStream>;
    let bobStream: ReturnType<typeof openGlobalEventStream>;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TestRequestContextModule,
          // The default-config app above already registered the shared
          // RamAdapter; a second `new RamAdapter(...)` is rejected, so this
          // app reuses the ambient adapter.
          GraphExecutionModule.forRoot({
            initAdapter: false,
            execution: { enableGlobalEventStream: true },
            runs: { auth: "optional", allowAnonymousAccess: true },
          }),
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      await app.listen(0);
      const address = app.getHttpServer().address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine the ephemeral test HTTP port");
      }
      port = address.port;
      moduleRef.get(GraphNodeCatalogue).registerExecutor("test.gate", gates.executor);
    });

    afterAll(async () => {
      gates.releaseAll();
      aliceStream?.close();
      bobStream?.close();
      try {
        await app.close();
      } catch {
        // already closed
      }
    });

    it("2. a non-owner on the global stream receives no events for another user's run; the owner receives their own", async () => {
      // both subscribers are connected before the run exists
      aliceStream = openGlobalEventStream(port, "alice");
      bobStream = openGlobalEventStream(port, "bob");
      expect(await aliceStream.ready).toBe(200);
      expect(await bobStream.ready).toBe(200);

      // alice starts a gated run; bob is not the owner
      const res = await request(app.getHttpServer())
        .post("/graph/runs")
        .set(TEST_USER_HEADER, "alice")
        .send({
          workflow: gateDocument("glob-own", ["glob-own-g1"]),
          inputs: { value: 1 },
        });
      expect(res.status).toBe(202);
      const runId = res.body.runId as string;

      // hold the run live until both streams have had every chance to
      // (wrongly) receive the run's non-terminal events
      await gates.waitForEntry(gateKey(runId, "glob-own-g1"));
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
      expect(bobStream.frames.filter((frame) => frame.runId === runId)).toHaveLength(0);

      gates.release(gateKey(runId, "glob-own-g1"));

      // the owner receives her own run's events, through the terminal event
      const terminal = await aliceStream.waitFor(
        (frame) => frame.runId === runId && isGraphRunTerminalEventType(frame.envelope.type)
      );
      expect(terminal.envelope.type).toBe(
        GraphExecutionEventType.WORKFLOW_COMPLETED
      );
      const aliceRunFrames = aliceStream.frames.filter(
        (frame) => frame.runId === runId
      );
      expect(aliceRunFrames.length).toBeGreaterThanOrEqual(5);
      const aliceTypes = aliceRunFrames.map((frame) => frame.type);
      expect(aliceTypes).toContain(GraphExecutionEventType.WORKFLOW_STARTED);
      expect(aliceTypes).toContain(GraphExecutionEventType.WORKFLOW_PLANNED);
      expect(aliceTypes).toContain(GraphExecutionEventType.NODE_STARTED);

      // the non-owner never received a single frame for alice's run —
      // not live, not on completion
      expect(bobStream.frames.filter((frame) => frame.runId === runId)).toHaveLength(0);
    });
  });
});
