/**
 * @module integrations/tests/unit/graph/CodeGraphNodeExecutor.test
 * @summary Unit tests for the Code node executor (DECAF-32 §22.4, DECAF-34 §7.5).
 */
import { CodeGraphNodeExecutor } from "../../../src/graph/engine/execution/CodeGraphNodeExecutor";
import { IsolatedVmCodeSandboxEvaluator } from "../../../src/graph/engine/execution/IsolatedVmCodeSandboxEvaluator";
import { GraphExecutionContext } from "../../../src/graph/engine/execution/GraphExecutionContext";
import { GraphExecutionError } from "../../../src/graph/engine/errors/GraphExecutionError";
import { GraphInputError } from "../../../src/graph/engine/errors/GraphInputError";
import type { CodeSandboxEvaluator } from "../../../src/graph/engine/execution/CodeSandboxEvaluator";
import type { GraphNodeDefinition } from "@decaf-ts/ui-decorators/graph";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

/**
 * Builds a minimal {@link GraphExecutionContext} for a Code node.
 * The node's graph metadata carries only `timeoutMs` (code now comes from
 * the `code` input port, spliced from {@link CodeInputSchema}).
 */
function buildContext(
  nodeMetadata: Record<string, unknown> = {},
  contextMetadata: Record<string, unknown> = {}
): GraphExecutionContext {
  const node: GraphNodeDefinition = {
    name: "CodeNode",
    tag: "CodeNode",
    kind: "core.flow.code",
    labels: [],
    ports: [],
    graph: { metadata: nodeMetadata } as never,
  };
  const workflow = { name: "wf" } as GraphWorkflowDefinition;
  return new GraphExecutionContext(
    "run-1",
    undefined,
    workflow,
    node,
    ["CodeNode"],
    async () => {},
    contextMetadata
  );
}

describe("CodeGraphNodeExecutor", () => {
  describe("with a registered CodeSandboxEvaluator", () => {
    const evaluator = new IsolatedVmCodeSandboxEvaluator();
    const executor = new CodeGraphNodeExecutor({ codeSandboxEvaluator: evaluator });

    it("executes a simple expression and returns the result on the result port", async () => {
      const ctx = buildContext({}, { vars: { a: 2, b: 3 } });
      const result = await executor.execute({ code: "return $vars.a + $vars.b;" }, ctx);
      expect(result).toEqual({ result: 5 });
    });

    it("executes a statement-mode code with return", async () => {
      const ctx = buildContext({}, { vars: { a: 3, b: 4 } });
      const result = await executor.execute(
        { code: "const sum = $vars.a + $vars.b; return sum * 2;" },
        ctx
      );
      expect(result).toEqual({ result: 14 });
    });

    it("passes $vars from context metadata", async () => {
      const ctx = buildContext({}, { vars: { topic: "hello" } });
      const result = await executor.execute({ code: "return $vars.topic;" }, ctx);
      expect(result).toEqual({ result: "hello" });
    });

    it("passes $item and $index from context metadata (loop body)", async () => {
      const ctx = buildContext({}, { item: "apple", index: 2 });
      const result = await executor.execute(
        { code: "return { item: $item, index: $index };" },
        ctx
      );
      expect(result).toEqual({
        result: { item: "apple", index: 2 },
      });
    });

    it("passes $node outputs from context metadata", async () => {
      const ctx = buildContext(
        {},
        { nodes: { Research: { output: { summary: "found" } } } }
      );
      const result = await executor.execute(
        { code: 'return $node["Research"].output.summary;' },
        ctx
      );
      expect(result).toEqual({ result: "found" });
    });

    it("defaults language to javascript when not set in metadata", async () => {
      const ctx = buildContext();
      const result = await executor.execute({ code: "return 42;" }, ctx);
      expect(result).toEqual({ result: 42 });
    });

    it("exposes $input as the full input values object (including code)", async () => {
      const ctx = buildContext();
      const result = await executor.execute(
        { code: "return $input.code.length;" },
        ctx
      );
      expect(result).toEqual({ result: "return $input.code.length;".length });
    });
  });

  describe("without a CodeSandboxEvaluator", () => {
    const executor = new CodeGraphNodeExecutor({});

    it("throws GRAPH_CODE_SANDBOX_NOT_CONFIGURED", async () => {
      const ctx = buildContext();
      await expect(executor.execute({ code: "return 1;" }, ctx)).rejects.toThrow(
        GraphExecutionError
      );
      await expect(executor.execute({ code: "return 1;" }, ctx)).rejects.toThrow(
        /CodeSandboxEvaluator.*registered/i
      );
    });

    it("throws when engine is undefined", async () => {
      const exec = new CodeGraphNodeExecutor(undefined);
      const ctx = buildContext();
      await expect(exec.execute({ code: "return 1;" }, ctx)).rejects.toThrow(
        /CodeSandboxEvaluator.*registered/i
      );
    });
  });

  describe("validation", () => {
    const evaluator = new IsolatedVmCodeSandboxEvaluator();
    const executor = new CodeGraphNodeExecutor({ codeSandboxEvaluator: evaluator });

    it("throws GraphInputError when input.code is empty", async () => {
      const ctx = buildContext();
      await expect(executor.execute({ code: "" }, ctx)).rejects.toThrow(
        GraphInputError
      );
      await expect(executor.execute({ code: "" }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("throws GraphInputError when input.code is whitespace", async () => {
      const ctx = buildContext();
      await expect(executor.execute({ code: "   " }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("throws GraphInputError when input.code is missing", async () => {
      const ctx = buildContext();
      await expect(executor.execute({}, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("throws GraphInputError when input.code is not a string", async () => {
      const ctx = buildContext();
      await expect(executor.execute({ code: 123 }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("propagates forbidden-token errors from the sandbox", async () => {
      const ctx = buildContext();
      await expect(
        executor.execute({ code: "require('fs')" }, ctx)
      ).rejects.toThrow(/Identifier "require".*not allowed/i);
    });

    it("propagates runtime errors from the sandbox", async () => {
      const ctx = buildContext();
      await expect(
        executor.execute({ code: "return undefinedVar.foo;" }, ctx)
      ).rejects.toThrow(/execution failed/i);
    });
  });

  describe("with a custom CodeSandboxEvaluator", () => {
    it("delegates to the custom evaluator and returns its result", async () => {
      const custom: CodeSandboxEvaluator = {
        evaluate: (ctx) => `custom:${ctx.code}`,
      };
      const executor = new CodeGraphNodeExecutor({ codeSandboxEvaluator: custom });
      const ctx = buildContext();
      const result = await executor.execute({ code: "return 1;" }, ctx);
      expect(result).toEqual({ result: "custom:return 1;" });
    });

    it("passes the code, language, and input to the evaluator", async () => {
      let captured: Record<string, unknown> = {};
      const custom: CodeSandboxEvaluator = {
        evaluate: (ctx) => {
          captured = {
            code: ctx.code,
            language: ctx.language,
            input: ctx.input,
          };
          return "ok";
        },
      };
      const executor = new CodeGraphNodeExecutor({ codeSandboxEvaluator: custom });
      const ctx = buildContext();
      await executor.execute({ code: "return 1;" }, ctx);
      expect(captured).toEqual({
        code: "return 1;",
        language: "javascript",
        input: { code: "return 1;" },
      });
    });
  });
});
