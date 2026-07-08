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
 * Builds a minimal {@link GraphExecutionContext} for a Code node with the given
 * metadata and executor metadata.
 */
function buildContext(
  codeMetadata: Record<string, unknown>,
  contextMetadata: Record<string, unknown> = {}
): GraphExecutionContext {
  const node: GraphNodeDefinition = {
    name: "CodeNode",
    tag: "CodeNode",
    kind: "core.flow.code",
    labels: [],
    ports: [],
    graph: { metadata: { code: codeMetadata } } as never,
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
      const ctx = buildContext({ code: "$input.a + $input.b" });
      const result = await executor.execute({ input: { a: 2, b: 3 } }, ctx);
      expect(result).toEqual({ result: 5 });
    });

    it("executes a statement-mode code with return", async () => {
      const ctx = buildContext({
        code: "const sum = $input.a + $input.b; return sum * 2;",
      });
      const result = await executor.execute({ input: { a: 3, b: 4 } }, ctx);
      expect(result).toEqual({ result: 14 });
    });

    it("passes $vars from context metadata", async () => {
      const ctx = buildContext(
        { code: "return $vars.topic;" },
        { vars: { topic: "hello" } }
      );
      const result = await executor.execute({ input: {} }, ctx);
      expect(result).toEqual({ result: "hello" });
    });

    it("passes $item and $index from context metadata (loop body)", async () => {
      const ctx = buildContext(
        { code: "return { item: $item, index: $index };" },
        { item: "apple", index: 2 }
      );
      const result = await executor.execute({ input: {} }, ctx);
      expect(result).toEqual({
        result: { item: "apple", index: 2 },
      });
    });

    it("passes $node outputs from context metadata", async () => {
      const ctx = buildContext(
        { code: 'return $node["Research"].output.summary;' },
        { nodes: { Research: { output: { summary: "found" } } } }
      );
      const result = await executor.execute({ input: {} }, ctx);
      expect(result).toEqual({ result: "found" });
    });

    it("defaults language to javascript when not set in metadata", async () => {
      const ctx = buildContext({ code: "return 42;" });
      const result = await executor.execute({ input: {} }, ctx);
      expect(result).toEqual({ result: 42 });
    });

    it("forwards the full input object when no input port is present", async () => {
      const ctx = buildContext({ code: "return $input.value;" });
      const result = await executor.execute({ value: 99 }, ctx);
      expect(result).toEqual({ result: 99 });
    });

    it("wraps non-object input in a { value } wrapper", async () => {
      const ctx = buildContext({ code: "return $input.value;" });
      const result = await executor.execute({ input: 42 }, ctx);
      expect(result).toEqual({ result: 42 });
    });
  });

  describe("without a CodeSandboxEvaluator", () => {
    const executor = new CodeGraphNodeExecutor({});

    it("throws GRAPH_CODE_SANDBOX_NOT_CONFIGURED", async () => {
      const ctx = buildContext({ code: "return 1;" });
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        GraphExecutionError
      );
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /CodeSandboxEvaluator.*registered/i
      );
    });

    it("throws when engine is undefined", async () => {
      const exec = new CodeGraphNodeExecutor(undefined);
      const ctx = buildContext({ code: "return 1;" });
      await expect(exec.execute({ input: {} }, ctx)).rejects.toThrow(
        /CodeSandboxEvaluator.*registered/i
      );
    });
  });

  describe("validation", () => {
    const evaluator = new IsolatedVmCodeSandboxEvaluator();
    const executor = new CodeGraphNodeExecutor({ codeSandboxEvaluator: evaluator });

    it("throws GraphInputError when metadata.code is empty", async () => {
      const ctx = buildContext({ code: "" });
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        GraphInputError
      );
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("throws GraphInputError when metadata.code is whitespace", async () => {
      const ctx = buildContext({ code: "   " });
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("throws GraphInputError when metadata.code is missing", async () => {
      const ctx = buildContext({});
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("throws GraphInputError when metadata.code is not a string", async () => {
      const ctx = buildContext({ code: 123 });
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /no code to execute/i
      );
    });

    it("propagates forbidden-token errors from the sandbox", async () => {
      const ctx = buildContext({ code: "require('fs')" });
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /Identifier "require".*not allowed/i
      );
    });

    it("propagates runtime errors from the sandbox", async () => {
      const ctx = buildContext({ code: "return undefinedVar.foo;" });
      await expect(executor.execute({ input: {} }, ctx)).rejects.toThrow(
        /execution failed/i
      );
    });
  });

  describe("with a custom CodeSandboxEvaluator", () => {
    it("delegates to the custom evaluator and returns its result", async () => {
      const custom: CodeSandboxEvaluator = {
        evaluate: (ctx) => `custom:${ctx.code}`,
      };
      const executor = new CodeGraphNodeExecutor({ codeSandboxEvaluator: custom });
      const ctx = buildContext({ code: "return 1;" });
      const result = await executor.execute({ input: {} }, ctx);
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
      const ctx = buildContext({ code: "return 1;", language: "javascript" });
      await executor.execute({ input: { a: 1 } }, ctx);
      expect(captured).toEqual({
        code: "return 1;",
        language: "javascript",
        input: { a: 1 },
      });
    });
  });
});
