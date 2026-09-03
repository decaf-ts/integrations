/**
 * @module integrations/tests/unit/nest/GraphSecureDefaults
 * @summary SAA-595 regression tests: fail-closed module defaults (scenario 1
 * of the SAA-608 review follow-up).
 * @description Boots {@link GraphExecutionModule} with bare
 * `GraphExecutionModule.forRoot()` — NO options — next to the header-driven
 * test request context, and pins the secure defaults the SAA-595 hardening
 * introduced:
 * - a run created by an authenticated user (alice) is readable only by its
 *   owner: anonymous callers and other users (bob) get `403` on the run
 *   status, the run event stream, and the run result — without the DECAF-48
 *   §4.15 `allowAnonymousAccess` tolerance, ownership checks fail closed;
 * - the deprecated global `GET /graph/events` stream is disabled by default
 *   and answers `404`.
 *
 * This suite deliberately does NOT reuse `createGraphRunTestApp`: that
 * harness opts into `allowAnonymousAccess: true`, which is exactly the
 * tolerance these defaults must NOT carry.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import request from "supertest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import { GraphRunService } from "../../../src/graph";
import { GraphExecutionModule } from "../../../src/nest/graph";
import { linearDocument } from "../graph/fixtures";
import { TEST_USER_HEADER, TestRequestContextModule } from "./graphRunTestSupport";

jest.setTimeout(60000);

describe("GraphSecureDefaults (SAA-595 fail-closed defaults, bare forRoot)", () => {
  let app: INestApplication;
  let runService: GraphRunService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestRequestContextModule,
        // Bare forRoot(): NO options — runs.auth defaults to "required" and,
        // critically, allowAnonymousAccess stays false (fail-closed).
        GraphExecutionModule.forRoot(),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    runService = moduleRef.get(GraphRunService);
  });

  afterAll(async () => {
    try {
      await app.close();
    } catch {
      // already closed
    }
  });

  const api = () => request(app.getHttpServer());

  it("1. an owned run is denied to anonymous callers and other users on status, events, and results; the global stream is 404", async () => {
    // alice creates a run through the run lifecycle API
    const createRes = await api()
      .post("/graph/runs")
      .set(TEST_USER_HEADER, "alice")
      .send({ workflow: linearDocument(), inputs: { a: 1, b: 2 } });
    expect(createRes.status).toBe(202);
    const runId = createRes.body.runId as string;
    await runService.waitForRun(runId, "alice");

    // sanity: the owner still reads her own run
    const aliceStatus = await api()
      .get(`/graph/runs/${runId}`)
      .set(TEST_USER_HEADER, "alice");
    expect(aliceStatus.status).toBe(200);
    expect(aliceStatus.body.status).toBe("succeeded");

    // anonymous (no x-test-user): 403 on all three surfaces
    const anonStatus = await api().get(`/graph/runs/${runId}`);
    expect(anonStatus.status).toBe(403);
    expect(anonStatus.body.message).toContain("owned by another user");

    const anonEvents = await api().get(`/graph/runs/${runId}/events`);
    expect(anonEvents.status).toBe(403);

    const anonResult = await api().get(`/graph/results/${runId}`);
    expect(anonResult.status).toBe(403);
    expect(anonResult.body.message).toContain("owned by another user");

    // bob: 403 on all three surfaces
    const bobStatus = await api()
      .get(`/graph/runs/${runId}`)
      .set(TEST_USER_HEADER, "bob");
    expect(bobStatus.status).toBe(403);

    const bobEvents = await api()
      .get(`/graph/runs/${runId}/events`)
      .set(TEST_USER_HEADER, "bob");
    expect(bobEvents.status).toBe(403);

    const bobResult = await api()
      .get(`/graph/results/${runId}`)
      .set(TEST_USER_HEADER, "bob");
    expect(bobResult.status).toBe(403);
  });

  it("2. GET /graph/events answers 404 (global stream default-off)", async () => {
    const res = await api().get("/graph/events");
    expect(res.status).toBe(404);
    expect(res.body.message).toContain("global graph event stream is disabled");
  });
});
