/**
 * @module integrations/tests/unit/graph/GraphRunLogger.test
 * @summary Unit tests for the run logger + Log node executor (DECAF-48).
 */
import { GraphRunLogger } from "../../../src/graph/log/GraphRunLogger";
import { GraphExecutionContext } from "../../../src/graph/engine/execution/GraphExecutionContext";
import { LogGraphNodeExecutor } from "../../../src/graph/engine/execution/LogGraphNodeExecutor";
import { GraphExecutionEventType } from "../../../src/graph/shared/constants";
import type { GraphNodeDefinition } from "@decaf-ts/ui-decorators/graph";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

describe("GraphRunLogger", () => {
  it("forwards a structured GRAPH_RUN_LOG entry with the run attributes", async () => {
    const entries: unknown[] = [];
    let nodeId: string | undefined;
    const node: GraphNodeDefinition = {
      name: "LogNode",
      tag: "LogNode",
      kind: "core.utility.log",
      labels: [],
      ports: [],
      graph: {} as never,
    };
    const workflow = { name: "wf" } as GraphWorkflowDefinition;
    const ctx = new GraphExecutionContext(
      "run-1",
      undefined,
      workflow,
      node,
      ["LogNode"],
      async (event) => {
        nodeId = event.nodeId;
        if (event.type === GraphExecutionEventType.GRAPH_RUN_LOG) {
          entries.push(event.payload);
        }
      },
      { user: "alice" }
    );

    (ctx.logger as GraphRunLogger).info("hello from node", { detail: 42 });

    expect(entries).toHaveLength(1);
    const entry = entries[0] as {
      level: string;
      message: string;
      runId: string;
      workflowId: string;
      nodeId: string;
      user: string | null;
      timestamp: string;
      payload: { detail: number };
    };
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("hello from node");
    expect(entry.runId).toBe("run-1");
    expect(entry.workflowId).toBe("wf");
    expect(entry.nodeId).toBe("LogNode");
    expect(entry.user).toBe("alice");
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    expect(entry.payload).toEqual({ detail: 42 });
    expect(nodeId).toBe("LogNode");
  });

  it("emits warn/error log levels distinctly", async () => {
    const levels: string[] = [];
    const node: GraphNodeDefinition = {
      name: "N",
      tag: "N",
      kind: "core.flow.log",
      labels: [],
      ports: [],
      graph: {} as never,
    };
    const workflow = { name: "wf" } as GraphWorkflowDefinition;
    const ctx = new GraphExecutionContext(
      "run-2",
      undefined,
      workflow,
      node,
      ["N"],
      async (event) => {
        if (event.type === GraphExecutionEventType.GRAPH_RUN_LOG) {
          levels.push((event.payload as { level: string }).level);
        }
      }
    );

    (ctx.logger as GraphRunLogger).warn("warning line");
    (ctx.logger as GraphRunLogger).error("error line", { code: 500 });

    expect(levels).toEqual(["warn", "error"]);
  });

  it("uses null user when the context carries no identity", async () => {
    const node: GraphNodeDefinition = {
      name: "N",
      tag: "N",
      kind: "core.utility.log",
      labels: [],
      ports: [],
      graph: {} as never,
    };
    const workflow = { name: "wf" } as GraphWorkflowDefinition;
    let captured: unknown;
    const ctx = new GraphExecutionContext(
      "run-3",
      undefined,
      workflow,
      node,
      ["N"],
      async (event) => {
        if (event.type === GraphExecutionEventType.GRAPH_RUN_LOG) {
          captured = event.payload;
        }
      }
    );

    (ctx.logger as GraphRunLogger).info("anonymous");

    expect((captured as { user: string | null }).user).toBeNull();
  });
});

describe("LogGraphNodeExecutor", () => {
  it("logs its input through ctx.logger at the configured level", async () => {
    const captured: unknown[] = [];
    const node: GraphNodeDefinition = {
      name: "LogNode",
      tag: "LogNode",
      kind: "core.utility.log",
      labels: [],
      ports: [],
      props: { level: "warn" } as never,
      graph: {} as never,
    };
    const workflow = { name: "wf" } as GraphWorkflowDefinition;
    const ctx = new GraphExecutionContext(
      "run-1",
      undefined,
      workflow,
      node,
      ["LogNode"],
      async (event) => {
        if (event.type === GraphExecutionEventType.GRAPH_RUN_LOG) {
          captured.push(event.payload);
        }
      },
      { user: "bob" }
    );

    const executor = new LogGraphNodeExecutor();
    const result = await executor.execute({ value: "my value" }, ctx);

    expect(result).toEqual({ logged: "my value" });
    expect(captured).toHaveLength(1);
    const entry = captured[0] as {
      level: string;
      message: string;
      payload: { value: string };
      nodeId: string;
      user: string | null;
    };
    expect(entry.level).toBe("warn");
    expect(entry.message).toBe("Log node");
    expect(entry.payload).toEqual({ value: "my value" });
    expect(entry.nodeId).toBe("LogNode");
    expect(entry.user).toBe("bob");
  });

  it("defaults the log level to info when unset", async () => {
    const captured: unknown[] = [];
    const node: GraphNodeDefinition = {
      name: "LogNode",
      tag: "LogNode",
      kind: "core.utility.log",
      labels: [],
      ports: [],
      graph: {} as never,
    };
    const workflow = { name: "wf" } as GraphWorkflowDefinition;
    const ctx = new GraphExecutionContext(
      "run-2",
      undefined,
      workflow,
      node,
      ["LogNode"],
      async (event) => {
        if (event.type === GraphExecutionEventType.GRAPH_RUN_LOG) {
          captured.push(event.payload);
        }
      }
    );

    const executor = new LogGraphNodeExecutor();
    await executor.execute({ value: 42 }, ctx);

    expect((captured[0] as { level: string }).level).toBe("info");
  });
});
