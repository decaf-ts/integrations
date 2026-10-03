/**
 * @module integrations/tests/unit/nest/GraphErrorMapperNonLeakage.test
 * @summary SAA-156 fails-before coverage: the pre-DECAF-809 duplicate graph
 * controllers' catch-all `500` mappers must not serve the raw underlying error
 * message. Mirrors the SAA-116 `as-graph` suite for the `integrations` package.
 * @description Pins the SAA-116/SAA-123 acceptance criterion: a non-Decaf error
 * reaching `graphRunHttpErrorOf`
 * (`src/nest/graph/GraphRunController.ts`) or `graphWorkflowHttpErrorOf`
 * (`src/nest/graph/GraphWorkflowController.ts`) must be mapped to a **constant
 * generic** `500` body — never `e.message`/`String(e)`, which can carry adapter
 * internals (connection strings, credentials, table/column names, driver text).
 *
 * Both controllers are booted through `@nestjs/testing` with stubbed
 * `GraphRunService`/`GraphWorkflowService` providers whose methods reject with a
 * plain (non-Decaf) `Error` shaped like a leaked PostgreSQL connection string.
 * The mapped Decaf error classes' current contracts (`403`/`404`/`400`/`422`,
 * Nest `HttpException` pass-through) are pinned alongside the generic-500 shape.
 *
 * FAILS-BEFORE: against the unfixed tree each endpoint's body echoes
 * {@link SENSITIVE_MESSAGE}, so the generic-shape assertion fails. The
 * `servingErrors.ts` treatment makes every assertion pass.
 *
 * SAA-165 closes the untested non-`Error` branch: a thrown string (the pre-fix
 * `String(e)` leak path) and an object whose `toString()` throws are driven
 * through both controllers, and the `logUnmappedGraphServingError` try/catch guard
 * is exercised directly.
 *
 * SAA-166 extends the suite to the third live duplicate,
 * `graphExecutionHttpErrorOf` (`src/nest/graph/GraphExecutionController.ts`),
 * reachable from `GET /graph/results/:runId` via `GraphRunService.getRun`. The
 * same generic-500/no-leak contract and the mapped `403`/`404`/`400`/`HttpException`
 * pass-through branches are pinned, including the server-side `runId` correlation log.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";
import request from "supertest";
import { Test } from "@nestjs/testing";
import {
  HttpException,
  HttpStatus,
  type INestApplication,
} from "@nestjs/common";
import { Logging, LogLevel, LoggingMode } from "@decaf-ts/logging";
import { ForbiddenError } from "@decaf-ts/core";
import { NotFoundError, ValidationError } from "@decaf-ts/db-decorators";

import { GraphExecutionEngine, GraphRunService } from "../../../src/graph";
import {
  GraphWorkflowService,
  GRAPH_WORKFLOW_OPTIONS,
} from "../../../src/nest/graph/GraphWorkflowService";
import { GraphWorkflowDocumentRejectedError } from "../../../src/nest/graph/GraphWorkflowErrors";
import {
  GRAPH_RUN_OPTIONS,
  GraphRunController,
} from "../../../src/nest/graph/GraphRunController";
import { GraphWorkflowController } from "../../../src/nest/graph/GraphWorkflowController";
import { GraphResultService } from "../../../src/nest/graph/GraphResultService";
import {
  GRAPH_EXECUTION_OPTIONS,
  GraphExecutionController,
} from "../../../src/nest/graph/GraphExecutionController";
import {
  GRAPH_SERVING_INTERNAL_ERROR_MESSAGE,
  logUnmappedGraphServingError,
} from "../../../src/nest/graph/servingErrors";

jest.setTimeout(30000);

/**
 * Non-Decaf (`Error`) message shaped like the adapter/driver internals the
 * SAA-116 finding warns about (connection string, credential, host, relation).
 * The mapper's catch-all branch must never echo any part of it to the client.
 */
const SENSITIVE_MESSAGE =
  'connect ECONNREFUSED postgres://graph_admin:s3cr3t-p@db.internal:5432/graph_db: relation "graph_runs" does not exist';

/** Sensitive substrings a generic `500` body must not carry. */
const SENSITIVE_TOKENS = [
  "ECONNREFUSED",
  "postgres://",
  "graph_admin",
  "s3cr3t-p",
  "db.internal",
  "graph_db",
  "graph_runs",
];

/**
 * The constant generic message the fix must return for an unmapped server-side
 * failure. Compared case-insensitively so either the literal
 * `"Internal server error"` or Nest's `InternalServerErrorException` default
 * (`"Internal Server Error"`) satisfies the generic-shape contract while any
 * dynamic content still fails.
 */
const GENERIC_INTERNAL_ERROR_MESSAGE = "internal server error";

/** Stable prefix of the server-side log line the mapper emits for an unmapped failure. */
const UNMAPPED_ERROR_LOG_MARKER =
  "Graph request failed with an unmapped error";

/** Builds a fresh `Error` carrying {@link SENSITIVE_MESSAGE}. */
function sensitiveError(): Error {
  return new Error(SENSITIVE_MESSAGE);
}

/**
 * Builds a caught value that is not an `Error` and whose `toString()` throws.
 * Any coercion of it — the pre-fix `String(e)` branch and the current
 * `new Error(String(e))` wrap alike — throws, so only the `servingErrors`
 * try/catch guard can keep the mapper from propagating.
 *
 * @return {unknown} A hostile caught value whose `toString()` throws.
 */
function hostileToStringValue(): unknown {
  return {
    toString(): string {
      throw new Error("hostile toString");
    },
  };
}

/** Stubbed {@link GraphRunService}: every serving/store call rejects. */
function runServiceStub() {
  return {
    createRun: jest.fn().mockRejectedValue(sensitiveError()),
    getRun: jest.fn().mockRejectedValue(sensitiveError()),
    cancelRun: jest.fn().mockRejectedValue(sensitiveError()),
    listRunsByWorkflow: jest.fn().mockRejectedValue(sensitiveError()),
  };
}

/** Stubbed {@link GraphWorkflowService}: access passes, persistence/serving rejects. */
function workflowServiceStub() {
  return {
    assertAccess: jest.fn().mockResolvedValue(undefined),
    saveDocument: jest.fn().mockRejectedValue(sensitiveError()),
    saveSnapshot: jest.fn().mockRejectedValue(sensitiveError()),
    getDocument: jest.fn().mockRejectedValue(sensitiveError()),
    listWorkflows: jest.fn().mockRejectedValue(sensitiveError()),
    validateDocument: jest.fn().mockRejectedValue(sensitiveError()),
  };
}

/**
 * Stubbed {@link GraphExecutionEngine}: the execution controller registers an
 * observer in its constructor, so `observe` must exist; no execution is driven
 * through this surface by the SAA-166 cases.
 */
function engineStub() {
  return { observe: jest.fn() };
}

/**
 * Stubbed {@link GraphResultService}: result lookup returns `null` by default so
 * the ownership/error-mapping branches are reached before any result body is read.
 */
function resultServiceStub() {
  return {
    findByRunId: jest.fn().mockResolvedValue(null),
    saveResult: jest.fn().mockResolvedValue(undefined),
  };
}

interface HttpErrorResponse {
  /** HTTP status code of the response. */
  status: number;
  /** Parsed JSON body of the response. */
  body: unknown;
  /** Raw response text, used to catch leaks in non-JSON renderings. */
  text: string;
}

/**
 * Asserts a `500` response carries a constant generic body and none of the raw
 * underlying error text. This is a generic-shape assertion (status + constant
 * message), not merely the absence of the exact sensitive string.
 *
 * @param {HttpErrorResponse} res - The captured HTTP response.
 * @return {void}
 */
function expectGenericInternalServerError(res: HttpErrorResponse): void {
  expect(res.status).toBe(500);
  expect(res.body).toMatchObject({ statusCode: 500 });
  const message = (res.body as { message?: unknown }).message;
  expect(typeof message).toBe("string");
  expect((message as string).toLowerCase()).toBe(
    GENERIC_INTERNAL_ERROR_MESSAGE
  );

  const serialized = `${JSON.stringify(res.body)}\n${res.text}`;
  expect(serialized).not.toContain(SENSITIVE_MESSAGE);
  for (const token of SENSITIVE_TOKENS) {
    expect(serialized).not.toContain(token);
  }
}

/**
 * Runs a request while capturing the default `console.error` transport the
 * `@decaf-ts/logging` error level writes to (see `MiniLogger.methodFor`). The
 * suite never mutates the logging configuration, so the captured line is the real
 * rendered line under the default (`info` level, `raw` format) configuration.
 *
 * @param {function(): Promise<unknown>} run - Thunk issuing the supertest request.
 * @return {Promise<{result: HttpErrorResponse, lines: string[]}>} The HTTP response plus only the mapper's unmapped-error log lines.
 */
async function captureUnmappedErrorLog(
  run: () => Promise<unknown>
): Promise<{ result: HttpErrorResponse; lines: string[] }> {
  const captured: string[] = [];
  const spy = jest
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      captured.push(args.map((arg) => String(arg)).join(" "));
    });
  try {
    const result = (await run()) as HttpErrorResponse;
    return {
      result,
      lines: captured.filter((line) =>
        line.includes(UNMAPPED_ERROR_LOG_MARKER)
      ),
    };
  } finally {
    spy.mockRestore();
  }
}

/**
 * Runs a synchronous `logUnmappedGraphServingError` call while capturing the
 * default `console.error` transport, mirroring {@link captureUnmappedErrorLog} for
 * the direct mapper cases.
 *
 * @param {function(): void} run - Thunk invoking the mapper directly.
 * @return {string[]} Only the mapper's unmapped-error log lines.
 */
function captureUnmappedErrorLogSync(run: () => void): string[] {
  const captured: string[] = [];
  const spy = jest
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      captured.push(args.map((arg) => String(arg)).join(" "));
    });
  try {
    run();
    return captured.filter((line) => line.includes(UNMAPPED_ERROR_LOG_MARKER));
  } finally {
    spy.mockRestore();
  }
}

/**
 * Asserts the captured unmapped-error log lines carry the underlying error's own
 * detail. Under the default RAW pattern the underlying error is only surfaced via
 * the `error` argument's stack, so a regression that drops that argument from
 * `Logging.for(context).error(message, error, meta)` leaves the correlation id in
 * `{message}` while silently no longer logging the cause. The assertion targets
 * the error's stable message marker, not the full adapter stack.
 *
 * @param {string[]} lines - The mapper's captured unmapped-error log lines.
 * @return {void}
 */
function expectUnderlyingErrorLogged(lines: string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.join("\n")).toContain(SENSITIVE_MESSAGE);
}

describe("Graph 500 error mappers must not leak raw underlying errors (SAA-156 fails-before)", () => {
  let app: INestApplication;
  let runService: ReturnType<typeof runServiceStub>;
  let workflowService: ReturnType<typeof workflowServiceStub>;

  beforeAll(async () => {
    runService = runServiceStub();
    workflowService = workflowServiceStub();
    const moduleRef = await Test.createTestingModule({
      controllers: [GraphRunController, GraphWorkflowController],
      providers: [
        { provide: GraphRunService, useValue: runService },
        { provide: GraphWorkflowService, useValue: workflowService },
        { provide: GRAPH_RUN_OPTIONS, useValue: { auth: "optional" } },
        { provide: GRAPH_WORKFLOW_OPTIONS, useValue: { auth: "optional" } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      await app.close();
    } catch {
      // already closed
    }
  });

  const api = () => request(app.getHttpServer());

  describe("run controller (graphRunHttpErrorOf)", () => {
    it("1. POST /graph/runs answers a generic 500 without the raw store error", async () => {
      const res = await api().post("/graph/runs").send({});
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(runService.createRun).toHaveBeenCalled();
    });

    it("2. GET /graph/runs/:runId answers a generic 500 without the raw store error", async () => {
      const res = await api().get("/graph/runs/run-1");
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(runService.getRun).toHaveBeenCalled();
    });

    it("3. DELETE /graph/runs/:runId answers a generic 500 without the raw store error", async () => {
      const res = await api().delete("/graph/runs/run-1");
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(runService.cancelRun).toHaveBeenCalled();
    });

    it("4. SSE /graph/runs/:runId/events answers a generic 500 without the raw store error", async () => {
      const res = await api().get("/graph/runs/run-sse/events");
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(runService.getRun).toHaveBeenCalled();
    });
  });

  describe("workflow controller (graphWorkflowHttpErrorOf)", () => {
    it("5. PUT /graph/workflows/:workflowId answers a generic 500 without the raw store error", async () => {
      const res = await api().put("/graph/workflows/wf-1").send({});
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(workflowService.saveDocument).toHaveBeenCalled();
    });

    it("6. PUT /graph/workflows/:workflowId (snapshot wrapper) answers a generic 500 without the raw store error", async () => {
      const res = await api()
        .put("/graph/workflows/wf-1")
        .send({ document: { id: "wf-1" } });
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(workflowService.saveSnapshot).toHaveBeenCalled();
    });

    it("7. GET /graph/workflows/:workflowId answers a generic 500 without the raw store error", async () => {
      const res = await api().get("/graph/workflows/wf-1");
      expectGenericInternalServerError(res as unknown as HttpErrorResponse);
      expect(workflowService.getDocument).toHaveBeenCalled();
    });
  });

  describe("mapped Decaf errors and HttpException pass-through are unchanged", () => {
    it("8. GET /graph/runs/:runId maps ForbiddenError to a 403 naming the run", async () => {
      runService.getRun.mockRejectedValueOnce(new ForbiddenError("nope"));
      const res = (await api().get(
        "/graph/runs/run-owned"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(403);
      expect((res.body as { message?: string }).message).toBe(
        "Graph run 'run-owned' is owned by another user"
      );
    });

    it("9. GET /graph/runs/:runId maps NotFoundError to a 404", async () => {
      runService.getRun.mockRejectedValueOnce(new NotFoundError("missing"));
      const res = (await api().get(
        "/graph/runs/run-missing"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(404);
    });

    it("10. GET /graph/runs/:runId maps ValidationError to a 400", async () => {
      runService.getRun.mockRejectedValueOnce(new ValidationError("bad input"));
      const res = (await api().get(
        "/graph/runs/run-bad"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(400);
    });

    it("11. GET /graph/runs/:runId passes a Nest HttpException through unchanged", async () => {
      runService.getRun.mockRejectedValueOnce(
        new HttpException("teapot", HttpStatus.I_AM_A_TEAPOT)
      );
      const res = (await api().get(
        "/graph/runs/run-teapot"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(418);
      expect((res.body as { message?: string }).message).toBe("teapot");
    });

    it("12. PUT /graph/workflows/:workflowId maps GraphWorkflowDocumentRejectedError to a structured 422", async () => {
      const issues = [{ code: "c", path: "$.a", message: "bad" }];
      workflowService.saveDocument.mockRejectedValueOnce(
        new GraphWorkflowDocumentRejectedError(issues)
      );
      const res = (await api().put(
        "/graph/workflows/wf-rejected"
      ).send({})) as unknown as HttpErrorResponse;
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        message: "Graph workflow document rejected at the boundary",
        issues,
      });
    });

    it("13. PUT /graph/workflows/:workflowId maps ForbiddenError to a 403 naming the workflow", async () => {
      workflowService.saveDocument.mockRejectedValueOnce(
        new ForbiddenError("nope")
      );
      const res = (await api().put(
        "/graph/workflows/wf-owned"
      ).send({})) as unknown as HttpErrorResponse;
      expect(res.status).toBe(403);
      expect((res.body as { message?: string }).message).toBe(
        "Graph workflow 'wf-owned' is owned by another user"
      );
    });

    it("14. GET /graph/workflows/:workflowId maps NotFoundError to a 404", async () => {
      workflowService.getDocument.mockRejectedValueOnce(
        new NotFoundError("missing")
      );
      const res = (await api().get(
        "/graph/workflows/wf-missing"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(404);
    });

    it("15. GET /graph/workflows/:workflowId maps ValidationError to a 400", async () => {
      workflowService.getDocument.mockRejectedValueOnce(
        new ValidationError("bad input")
      );
      const res = (await api().get(
        "/graph/workflows/wf-bad"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(400);
    });

    it("16. GET /graph/workflows/:workflowId passes a Nest HttpException through unchanged", async () => {
      workflowService.getDocument.mockRejectedValueOnce(
        new HttpException("teapot", HttpStatus.I_AM_A_TEAPOT)
      );
      const res = (await api().get(
        "/graph/workflows/wf-teapot"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(418);
      expect((res.body as { message?: string }).message).toBe("teapot");
    });
  });

  describe("server-side correlation logging under the default configuration", () => {
    beforeAll(() => {
      const config = Logging.getConfig();
      expect(config.level).toBe(LogLevel.info);
      expect(config.format).toBe(LoggingMode.RAW);
      expect(config.style).toBe(false);
    });

    it("17. GET /graph/runs/:runId renders the runId correlation into the unmapped-error log line", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().get("/graph/runs/run-correlation-1")
      );
      expectGenericInternalServerError(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("run-correlation-1");
    });

    it("18. DELETE /graph/runs/:runId renders the runId correlation into the unmapped-error log line", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().delete("/graph/runs/run-correlation-2")
      );
      expectGenericInternalServerError(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("run-correlation-2");
    });

    it("19. POST /graph/runs with a workflowId renders the workflowId correlation into the unmapped-error log line", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().post("/graph/runs").send({ workflowId: "wf-run-correlation-1" })
      );
      expectGenericInternalServerError(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("wf-run-correlation-1");
    });

    it("20. PUT /graph/workflows/:workflowId renders the workflowId correlation into the unmapped-error log line", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().put("/graph/workflows/wf-correlation-1").send({})
      );
      expectGenericInternalServerError(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("wf-correlation-1");
    });

    it("21. GET /graph/workflows/:workflowId renders the workflowId correlation into the unmapped-error log line", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().get("/graph/workflows/wf-correlation-2")
      );
      expectGenericInternalServerError(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("wf-correlation-2");
    });
  });

  describe("underlying error detail logging", () => {
    it("22. GET /graph/runs/:runId logs the underlying error detail while the response stays generic", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().get("/graph/runs/run-underlying-error")
      );
      expectGenericInternalServerError(result);
      expectUnderlyingErrorLogged(lines);
    });

    it("23. GET /graph/workflows/:workflowId logs the underlying error detail while the response stays generic", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().get("/graph/workflows/wf-underlying-error")
      );
      expectGenericInternalServerError(result);
      expectUnderlyingErrorLogged(lines);
    });
  });

  describe("logger-failure safety (servingErrors try/catch guard)", () => {
    /** Builds a logger whose `error` throws, simulating a failing log transport. */
    function throwingLogger(): ReturnType<typeof Logging.for> {
      return {
        error: () => {
          throw new Error("logger transport unavailable");
        },
      } as unknown as ReturnType<typeof Logging.for>;
    }

    it("24. logUnmappedGraphServingError never throws when the logger itself fails", () => {
      const spy = jest
        .spyOn(Logging, "for")
        .mockReturnValue(throwingLogger());
      try {
        expect(() =>
          logUnmappedGraphServingError(
            "GraphRunController",
            sensitiveError(),
            { runId: "run-logger-failure" }
          )
        ).not.toThrow();
      } finally {
        spy.mockRestore();
      }
    });

    it("25. a request still answers the constant generic 500 when the logger fails", async () => {
      const spy = jest
        .spyOn(Logging, "for")
        .mockReturnValue(throwingLogger());
      try {
        const res = (await api().get(
          "/graph/runs/run-logger-failure"
        )) as unknown as HttpErrorResponse;
        expect(res.status).toBe(500);
        expect((res.body as { message?: unknown }).message).toBe(
          GRAPH_SERVING_INTERNAL_ERROR_MESSAGE
        );
        const serialized = `${JSON.stringify(res.body)}\n${res.text}`;
        expect(serialized).not.toContain("logger transport unavailable");
        for (const token of SENSITIVE_TOKENS) {
          expect(serialized).not.toContain(token);
        }
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("non-Error thrown values (String(e) / hostile toString guard, SAA-165)", () => {
    it("26. GET /graph/runs/:runId rejects with a thrown string and still answers the constant generic 500", async () => {
      runService.getRun.mockRejectedValueOnce(SENSITIVE_MESSAGE);
      const res = (await api().get(
        "/graph/runs/run-thrown-string"
      )) as unknown as HttpErrorResponse;
      expectGenericInternalServerError(res);
    });

    it("27. GET /graph/workflows/:workflowId rejects with a thrown string and still answers the constant generic 500", async () => {
      workflowService.getDocument.mockRejectedValueOnce(SENSITIVE_MESSAGE);
      const res = (await api().get(
        "/graph/workflows/wf-thrown-string"
      )) as unknown as HttpErrorResponse;
      expectGenericInternalServerError(res);
    });

    it("28. GET /graph/runs/:runId rejects with an object whose toString throws and still answers the constant generic 500", async () => {
      runService.getRun.mockRejectedValueOnce(hostileToStringValue());
      const res = (await api().get(
        "/graph/runs/run-hostile-tostring"
      )) as unknown as HttpErrorResponse;
      expectGenericInternalServerError(res);
    });

    it("29. GET /graph/workflows/:workflowId rejects with an object whose toString throws and still answers the constant generic 500", async () => {
      workflowService.getDocument.mockRejectedValueOnce(hostileToStringValue());
      const res = (await api().get(
        "/graph/workflows/wf-hostile-tostring"
      )) as unknown as HttpErrorResponse;
      expectGenericInternalServerError(res);
    });

    it("30. logUnmappedGraphServingError wraps a thrown string as an Error and never throws", () => {
      const lines = captureUnmappedErrorLogSync(() =>
        logUnmappedGraphServingError("GraphRunController", SENSITIVE_MESSAGE, {
          runId: "run-thrown-string",
        })
      );
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain(SENSITIVE_MESSAGE);
    });

    it("31. logUnmappedGraphServingError never throws on an object whose toString throws", () => {
      expect(() =>
        logUnmappedGraphServingError(
          "GraphRunController",
          hostileToStringValue(),
          { runId: "run-hostile-tostring" }
        )
      ).not.toThrow();
    });
  });
});

/**
 * SAA-166: the third live duplicate `graphExecutionHttpErrorOf`
 * (`src/nest/graph/GraphExecutionController.ts`), reachable from
 * `GET /graph/results/:runId` via `GraphRunService.getRun`. The mapper now reuses
 * the shared `servingErrors` helper; these cases pin the generic-500 non-leakage
 * shape and the unchanged mapped branches for that endpoint.
 *
 * FAILS-BEFORE: against the unfixed `graphExecutionHttpErrorOf` (HEAD, which
 * served `e.message`/`String(e)`) the generic-body assertions (32, 33, 39, 40)
 * fail; the mapped-branch assertions (34-38) pass either way.
 */
describe("GraphExecutionController result reads must not leak raw underlying errors (SAA-166 fails-before)", () => {
  let app: INestApplication;
  let engine: ReturnType<typeof engineStub>;
  let resultService: ReturnType<typeof resultServiceStub>;
  let workflowService: ReturnType<typeof workflowServiceStub>;
  let runService: ReturnType<typeof runServiceStub>;

  beforeAll(async () => {
    engine = engineStub();
    resultService = resultServiceStub();
    workflowService = workflowServiceStub();
    runService = runServiceStub();
    const moduleRef = await Test.createTestingModule({
      controllers: [GraphExecutionController],
      providers: [
        { provide: GraphExecutionEngine, useValue: engine },
        { provide: GraphResultService, useValue: resultService },
        { provide: GraphWorkflowService, useValue: workflowService },
        { provide: GraphRunService, useValue: runService },
        { provide: GRAPH_EXECUTION_OPTIONS, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      await app.close();
    } catch {
      // already closed
    }
  });

  const api = () => request(app.getHttpServer());

  describe("generic 500 for an unmapped store error (graphExecutionHttpErrorOf)", () => {
    it("32. GET /graph/results/:runId answers a constant generic 500 without the raw store error", async () => {
      runService.getRun.mockRejectedValueOnce(sensitiveError());
      const res = (await api().get(
        "/graph/results/run-exec-1"
      )) as unknown as HttpErrorResponse;
      expectGenericInternalServerError(res);
      expect(runService.getRun).toHaveBeenCalledWith(
        "run-exec-1",
        null,
        undefined
      );
    });

    it("33. the generic 500 body stays constant for a hostile toString caught value", async () => {
      runService.getRun.mockRejectedValueOnce(hostileToStringValue());
      const res = (await api().get(
        "/graph/results/run-exec-hostile"
      )) as unknown as HttpErrorResponse;
      expectGenericInternalServerError(res);
    });
  });

  describe("mapped branches and HttpException pass-through are unchanged", () => {
    it("34. GET /graph/results/:runId maps ForbiddenError to a 403 naming the run", async () => {
      runService.getRun.mockRejectedValueOnce(new ForbiddenError("nope"));
      const res = (await api().get(
        "/graph/results/run-exec-owned"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(403);
      expect((res.body as { message?: string }).message).toBe(
        "Graph run 'run-exec-owned' is owned by another user"
      );
    });

    it("35. GET /graph/results/:runId maps NotFoundError to a 404", async () => {
      runService.getRun.mockRejectedValueOnce(new NotFoundError("missing"));
      const res = (await api().get(
        "/graph/results/run-exec-missing"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(404);
    });

    it("36. GET /graph/results/:runId maps ValidationError to a 400", async () => {
      runService.getRun.mockRejectedValueOnce(new ValidationError("bad input"));
      const res = (await api().get(
        "/graph/results/run-exec-bad"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(400);
    });

    it("37. GET /graph/results/:runId passes a Nest HttpException through unchanged", async () => {
      runService.getRun.mockRejectedValueOnce(
        new HttpException("teapot", HttpStatus.I_AM_A_TEAPOT)
      );
      const res = (await api().get(
        "/graph/results/run-exec-teapot"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(418);
      expect((res.body as { message?: string }).message).toBe("teapot");
    });

    it("38. a missing persisted result (no run error) still answers the dedicated 404", async () => {
      runService.getRun.mockResolvedValueOnce({
        runId: "run-exec-no-result",
        ownerUser: null,
      });
      resultService.findByRunId.mockResolvedValueOnce(null);
      const res = (await api().get(
        "/graph/results/run-exec-no-result"
      )) as unknown as HttpErrorResponse;
      expect(res.status).toBe(404);
      expect((res.body as { message?: string }).message).toContain(
        "run-exec-no-result"
      );
    });
  });

  describe("server-side correlation logging", () => {
    it("39. GET /graph/results/:runId renders the runId correlation and underlying error into the unmapped-error log line", async () => {
      const { result, lines } = await captureUnmappedErrorLog(() =>
        api().get("/graph/results/run-exec-correlation-1")
      );
      expectGenericInternalServerError(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("run-exec-correlation-1");
      expectUnderlyingErrorLogged(lines);
    });

    it("40. the raw store error never appears in the response body or raw text", async () => {
      const { result } = await captureUnmappedErrorLog(() =>
        api().get("/graph/results/run-exec-no-leak")
      );
      const serialized = `${JSON.stringify(result.body)}\n${result.text}`;
      expect(serialized).not.toContain(SENSITIVE_MESSAGE);
      for (const token of SENSITIVE_TOKENS) {
        expect(serialized).not.toContain(token);
      }
    });
  });
});
