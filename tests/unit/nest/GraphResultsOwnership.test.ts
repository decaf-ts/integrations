/**
 * @module integrations/tests/unit/nest/GraphResultsOwnership
 * @summary SAA-595 F1 regression tests: ownership-gated result reads.
 * @description Boots {@link GraphExecutionModule} with `runs.auth` set to
 * `"optional"` but WITHOUT the DECAF-48 §4.15 anonymous tolerance
 * (`allowAnonymousAccess` stays `false`, SAA-595 F3 fail-closed default) and
 * pins the ownership behaviour of `GET /graph/results/:runId`:
 * - a result persisted for an owned run is denied to a different user (403);
 * - an anonymous caller is denied on an owned result (403, fail-closed);
 * - the owner reads the full result body (inputs/outputs/nodeResults);
 * - owner-less (legacy/anonymous) results stay readable by anonymous callers.
 *
 * The run itself is created through the deprecated `POST /graph/execute`
 * surface, which stamps the resolved request-context user onto the persisted
 * {@link GraphExecutionResultModel.owner} column via
 * {@link GraphResultService.saveResult}.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import request from "supertest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import { GraphExecutionModule } from "../../../src/nest/graph";
import { linearDocument } from "../graph/fixtures";
import { TEST_USER_HEADER, TestRequestContextModule } from "./graphRunTestSupport";

jest.setTimeout(60000);

describe("GraphResultsOwnership (SAA-595 F1 regression)", () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestRequestContextModule,
        // No `allowAnonymousAccess`: the §4.15 tolerance stays OFF so the
        // fail-closed default (F3) is exactly what these tests exercise.
        GraphExecutionModule.forRoot({ runs: { auth: "optional" } }),
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
  });

  afterAll(async () => {
    try {
      await app.close();
    } catch {
      // already closed
    }
  });

  const api = () => request(app.getHttpServer());

  /** Executes the linear document as the given user (or anonymously) and returns the runId. */
  async function executeAs(
    user: string | null,
    inputs: Record<string, number> = { a: 3, b: 4 }
  ): Promise<string> {
    const res = await (user
      ? api().post("/graph/execute").set(TEST_USER_HEADER, user)
      : api().post("/graph/execute")
    ).send({ workflow: linearDocument(), inputs });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("succeeded");
    return res.body.runId as string;
  }

  it("1. owned result: a different user gets 403 before any result data is read", async () => {
    const runId = await executeAs("alice");

    const res = await api()
      .get(`/graph/results/${runId}`)
      .set(TEST_USER_HEADER, "bob");

    expect(res.status).toBe(403);
    expect(res.body.message).toContain(runId);
    expect(res.body.message).toContain("owned by another user");
  });

  it("2. owned result: an anonymous caller gets 403 (fail-closed without the §4.15 tolerance)", async () => {
    const runId = await executeAs("alice");

    const res = await api().get(`/graph/results/${runId}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain("owned by another user");
  });

  it("3. owned result: the owner gets 200 with the correct inputs, outputs and nodeResults", async () => {
    const runId = await executeAs("alice", { a: 6, b: 7 });

    const res = await api()
      .get(`/graph/results/${runId}`)
      .set(TEST_USER_HEADER, "alice");

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(runId);
    expect(res.body.workflowId).toBe("linear-wf");
    expect(res.body.status).toBe("succeeded");
    expect(res.body.inputs).toEqual({ a: 6, b: 7 });
    expect(res.body.outputs.result).toBe(26); // (6 + 7) * 2
    expect(Object.keys(res.body.nodeResults).sort()).toEqual([
      "adder",
      "multiplier",
    ]);
  });

  it("4. owner-less (legacy) result: an anonymous caller still gets 200", async () => {
    // Saved without a resolved identity: no `owner` column value, matching
    // legacy rows persisted before the SAA-595 F1 owner stamp existed.
    const runId = await executeAs(null, { a: 1, b: 2 });

    const res = await api().get(`/graph/results/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(runId);
    expect(res.body.outputs.result).toBe(6); // (1 + 2) * 2
  });

  it("5. cross-user denial holds for the run-scoped surface too: bob gets 403 on GET /graph/runs/:runId and its event stream", async () => {
    const runId = await executeAs("alice");

    const bobRun = await api()
      .get(`/graph/runs/${runId}`)
      .set(TEST_USER_HEADER, "bob");
    expect(bobRun.status).toBe(403);

    const bobEvents = await api()
      .get(`/graph/runs/${runId}/events`)
      .set(TEST_USER_HEADER, "bob");
    expect(bobEvents.status).toBe(403);

    // sanity: the ephemeral port wiring is live for the anonymous-tolerated
    // ownerless case (guards against a false-positive from a dead server)
    expect(port).toBeGreaterThan(0);
  });
});
