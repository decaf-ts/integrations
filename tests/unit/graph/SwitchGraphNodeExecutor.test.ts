/**
 * @module integrations/tests/unit/graph/SwitchGraphNodeExecutor.test
 * @summary Unit tests for the Switch flow-control node executor (DECAF-32 §22.2.2, DECAF-34 §6.2).
 */
import { SwitchGraphNodeExecutor } from "../../../src/graph/engine/execution/SwitchGraphNodeExecutor";
import { GraphExecutionContext } from "../../../src/graph/engine/execution/GraphExecutionContext";
import { GraphExecutionError } from "../../../src/graph/engine/errors/GraphExecutionError";
import { IsolatedVmCodeSandboxEvaluator } from "../../../src/graph/engine/execution/IsolatedVmCodeSandboxEvaluator";
import type { CodeSandboxEvaluator } from "../../../src/graph/engine/execution/CodeSandboxEvaluator";
import type { GraphNodeDefinition, GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";
import type { SwitchNodeMetadata } from "../../../src/graph/shared/types";

/**
 * Builds a minimal {@link GraphExecutionContext} for a Switch node whose
 * `graph.metadata.switch` carries the given {@link SwitchNodeMetadata}.
 */
function buildContext(
  switchMeta: SwitchNodeMetadata,
  contextMetadata: Record<string, unknown> = {}
): GraphExecutionContext {
  const node: GraphNodeDefinition = {
    name: "SwitchNode",
    tag: "SwitchNode",
    kind: "core.flow.switch",
    labels: [],
    ports: [],
    graph: { metadata: { switch: switchMeta } } as never,
  };
  const workflow = { name: "wf" } as GraphWorkflowDefinition;
  return new GraphExecutionContext(
    "run-1",
    undefined,
    workflow,
    node,
    ["SwitchNode"],
    async () => {},
    contextMetadata
  );
}

describe("SwitchGraphNodeExecutor", () => {
  describe("ConditionExpression (graphical mode)", () => {
    const executor = new SwitchGraphNodeExecutor({});

    it("routes to the first matching case output port", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Is 5",
            outputPort: "five",
            condition: { op: "eq", left: { path: "n" }, right: { const: 5 } },
          },
          {
            id: "c2",
            label: "Is 10",
            outputPort: "ten",
            condition: { op: "eq", left: { path: "n" }, right: { const: 10 } },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      const result = await executor.execute({ value: { n: 10 } }, ctx);
      expect(result).toEqual({ ten: { n: 10 } });
    });

    it("routes to the default port when no case matches", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Is 5",
            outputPort: "five",
            condition: { op: "eq", left: { path: "n" }, right: { const: 5 } },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      const result = await executor.execute({ value: { n: 99 } }, ctx);
      expect(result).toEqual({ default: { n: 99 } });
    });

    it("returns an empty object when no case matches and hasDefault is false", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Is 5",
            outputPort: "five",
            condition: { op: "eq", left: { path: "n" }, right: { const: 5 } },
          },
        ],
        defaultPort: "default",
        hasDefault: false,
      };
      const ctx = buildContext(meta);
      const result = await executor.execute({ value: { n: 99 } }, ctx);
      expect(result).toEqual({});
    });

    it("evaluates cases in order — first match wins", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "First",
            outputPort: "first",
            condition: { op: "gt", left: { path: "n" }, right: { const: 0 } },
          },
          {
            id: "c2",
            label: "Second",
            outputPort: "second",
            condition: { op: "gt", left: { path: "n" }, right: { const: 100 } },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      // n=50 matches the first case (gt 0) but not the second (gt 100).
      const result = await executor.execute({ value: { n: 50 } }, ctx);
      expect(result).toEqual({ first: { n: 50 } });
    });

    it("supports the exists operator", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Has name",
            outputPort: "named",
            condition: { op: "exists", value: { path: "name" } },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      expect(await executor.execute({ value: { name: "foo" } }, ctx)).toEqual({
        named: { name: "foo" },
      });
      expect(await executor.execute({ value: {} }, ctx)).toEqual({
        default: {},
      });
    });

    it("supports composite and/or/not conditions", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Range",
            outputPort: "inRange",
            condition: {
              op: "and",
              conditions: [
                { op: "gte", left: { path: "n" }, right: { const: 10 } },
                { op: "lte", left: { path: "n" }, right: { const: 20 } },
              ],
            },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      expect(await executor.execute({ value: { n: 15 } }, ctx)).toEqual({
        inRange: { n: 15 },
      });
      expect(await executor.execute({ value: { n: 25 } }, ctx)).toEqual({
        default: { n: 25 },
      });
    });
  });

  describe("CodeCondition (code mode)", () => {
    const evaluator = new IsolatedVmCodeSandboxEvaluator();
    const executor = new SwitchGraphNodeExecutor({
      codeSandboxEvaluator: evaluator,
    });

    it("evaluates a code condition and routes on true", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Even",
            outputPort: "even",
            condition: { type: "code", code: "return $index % 2 === 0;" },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta, { index: 4 });
      const result = await executor.execute({ value: "item" }, ctx);
      expect(result).toEqual({ even: "item" });
    });

    it("falls to default when code condition returns false", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Even",
            outputPort: "even",
            condition: { type: "code", code: "return $index % 2 === 0;" },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta, { index: 3 });
      const result = await executor.execute({ value: "item" }, ctx);
      expect(result).toEqual({ default: "item" });
    });

    it("coerces truthy non-boolean sandbox results to true", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Truthy",
            outputPort: "yes",
            condition: { type: "code", code: "return $input.value;" },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      expect(await executor.execute({ value: "non-empty" }, ctx)).toEqual({
        yes: "non-empty",
      });
      expect(await executor.execute({ value: 0 }, ctx)).toEqual({
        default: 0,
      });
    });

    it("passes $vars from context metadata to the sandbox", async () => {
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Match var",
            outputPort: "matched",
            condition: {
              type: "code",
              code: "return $vars.mode === 'test';",
            },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta, { vars: { mode: "test" } });
      expect(await executor.execute({ value: 1 }, ctx)).toEqual({
        matched: 1,
      });
    });
  });

  describe("without a CodeSandboxEvaluator", () => {
    it("throws GRAPH_CODE_SANDBOX_NOT_CONFIGURED for code conditions", async () => {
      const executor = new SwitchGraphNodeExecutor({});
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "C",
            outputPort: "c",
            condition: { type: "code", code: "return true;" },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      await expect(executor.execute({ value: 1 }, ctx)).rejects.toThrow(
        GraphExecutionError
      );
      await expect(executor.execute({ value: 1 }, ctx)).rejects.toThrow(
        /CodeSandboxEvaluator.*registered/i
      );
    });

    it("throws when engine is undefined", async () => {
      const executor = new SwitchGraphNodeExecutor(undefined);
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "C",
            outputPort: "c",
            condition: { type: "code", code: "return true;" },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      await expect(executor.execute({ value: 1 }, ctx)).rejects.toThrow(
        /CodeSandboxEvaluator.*registered/i
      );
    });
  });

  describe("unknown condition type", () => {
    it("throws GraphExecutionError", async () => {
      const executor = new SwitchGraphNodeExecutor({});
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "Bad",
            outputPort: "bad",
            condition: { bogus: true } as never,
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      await expect(executor.execute({ value: 1 }, ctx)).rejects.toThrow(
        GraphExecutionError
      );
      await expect(executor.execute({ value: 1 }, ctx)).rejects.toThrow(
        /Unknown switch case condition/i
      );
    });
  });

  describe("empty / missing metadata", () => {
    it("routes to default when there are no cases", async () => {
      const executor = new SwitchGraphNodeExecutor({});
      const ctx = buildContext({ cases: [], defaultPort: "default" });
      const result = await executor.execute({ value: 42 }, ctx);
      expect(result).toEqual({ default: 42 });
    });

    it("returns empty when no cases and hasDefault is false", async () => {
      const executor = new SwitchGraphNodeExecutor({});
      const ctx = buildContext({
        cases: [],
        defaultPort: "default",
        hasDefault: false,
      });
      const result = await executor.execute({ value: 42 }, ctx);
      expect(result).toEqual({});
    });
  });

  describe("with a custom CodeSandboxEvaluator", () => {
    it("delegates to the custom evaluator", async () => {
      const custom: CodeSandboxEvaluator = {
        evaluate: (ctx) => `code-result:${ctx.code}`,
      };
      const executor = new SwitchGraphNodeExecutor({
        codeSandboxEvaluator: custom,
      });
      const meta: SwitchNodeMetadata = {
        cases: [
          {
            id: "c1",
            label: "C",
            outputPort: "c",
            condition: { type: "code", code: "return true;" },
          },
        ],
        defaultPort: "default",
      };
      const ctx = buildContext(meta);
      const result = await executor.execute({ value: 1 }, ctx);
      // "code-result:return true;" is a truthy string → routes to case port.
      expect(result).toEqual({ c: 1 });
    });
  });
});
