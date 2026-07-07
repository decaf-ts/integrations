/**
 * @module integrations/nest/graph/GraphExecutorRegistryFactory
 * @summary Factory that builds a populated {@link GraphNodeExecutorRegistry}.
 * @description Creates a registry pre-loaded with the demo executors used by
 * the graph execution backend's sample workflows. The executors cover the
 * publishing-workflow node tags, the flow-control kinds, the agent kind, and
 * the loop kinds. Additional executors can be registered on the returned
 * registry before it is handed to the {@link GraphExecutionEngine}.
 */
import {
  GraphNodeExecutorRegistry,
  GraphExecutionEngine,
  type GraphNodeExecutor,
  type GraphExecutionContext,
  type GraphExecutionValues,
  ConditionExpressionEvaluator,
  ForeachGraphNodeExecutor,
  WhileGraphNodeExecutor,
  UntilGraphNodeExecutor,
} from "../../graph";
import type {
  SwitchNodeMetadata,
  SwitchCaseCondition,
  ConditionExpression,
} from "../../graph";

type ExecutorFn = (
  input: GraphExecutionValues,
  context: GraphExecutionContext,
) => GraphExecutionValues | Promise<GraphExecutionValues>;

const executorMap: Record<string, ExecutorFn> = {
  "math.add": (input) => ({ sum: Number(input.a) + Number(input.b) }),
  "math.multiply": (input) => ({ product: Number(input.x) * 2 }),
  "graph-intake-workflow": (input) => ({
    brief: `[Normalized brief] ${String(input["request"] ?? "")}`,
  }),
  "graph-planning-pipeline": (input) => ({
    plan: `[Plan] Steps derived from: ${String(input["brief"] ?? "")}`,
  }),
  "graph-draft-node": (input) => ({
    draft: `[Draft] ${String(input["plan"] ?? "")}`,
  }),
  "graph-review-node": (input) => ({
    approved: `[Approved] ${String(input["draft"] ?? "")}`,
  }),
  "graph-publish-workflow": (input) => ({
    artifact: `[Published] ${String(input["approved"] ?? "")}`,
  }),
  "core.flow.map": (input) => ({ result: { mapped: input["value"] ?? input } }),
  "core.flow.delay": (input) => ({ valueOut: input["value"] ?? input }),
  "core.flow.return": (input) => ({ result: input["value"] ?? input }),
  "core.flow.merge": (input) => ({ merged: input["values"] ?? input }),
  "core.flow.if": (input) => ({ then: input["value"] ?? input }),
  "core.flow.switch": (input, context) => {
    const meta = (context.node.graph?.metadata as Record<string, unknown> | undefined)?.["switch"] as
      | SwitchNodeMetadata
      | undefined;
    const inputValue = input["value"] ?? input;
    if (!meta || !meta.cases || meta.cases.length === 0) {
      return { [meta?.defaultPort ?? "default"]: inputValue };
    }
    const evaluator = new ConditionExpressionEvaluator();
    for (const c of meta.cases) {
      const cond = c.condition as SwitchCaseCondition;
      if ("op" in cond) {
        try {
          if (evaluator.evaluate(cond as ConditionExpression, inputValue)) {
            return { [c.outputPort]: inputValue };
          }
        } catch {
          // skip unparseable conditions in demo
        }
      }
    }
    return { [meta.defaultPort ?? "default"]: inputValue };
  },
  "core.flow.parallel": (input) => ({ branches: [input["value"] ?? input] }),
  "core.flow.errorBoundary": (input) => ({ result: input["value"] ?? input }),
  "core.flow.humanApproval": (input) => ({ approved: input["value"] ?? input }),
  "core.flow.code": (input) => ({ result: input["input"] ?? input }),
  "core.agent": (input) => ({
    response: `[Agent response] ${String(input["prompt"] ?? "")}`,
    actions: [],
  }),
};

/**
 * Builds a {@link GraphNodeExecutorRegistry} populated with the demo executors.
 *
 * Executors are registered by **node kind** (the same key the engine uses to
 * resolve executors at runtime). The for-angular demo nodes use the kind as
 * their tag, so the same key works for both dispatch-by-kind and
 * dispatch-by-tag.
 *
 * Registered kinds:
 * - `math.add`, `math.multiply` — arithmetic demo executors.
 * - `graph-intake-workflow`, `graph-planning-pipeline`, `graph-draft-node`,
 *   `graph-review-node`, `graph-publish-workflow` — publishing workflow demo.
 * - `core.flow.*` — flow-control kinds (map, delay, return, merge, if, switch,
 *   parallel, errorBoundary, humanApproval, code).
 * - `core.agent` — agent node.
 * - `core.loop.foreach`, `core.loop.while`, `core.loop.until` — loop executors
 *   (registered after the engine is created via `onEngineCreated`).
 *
 * @param extra - Additional executors to merge into the registry.
 * @returns A populated registry ready for use with {@link GraphExecutionEngine}.
 */
export function createGraphExecutorRegistry(
  extra?: Record<string, GraphNodeExecutor>,
): GraphNodeExecutorRegistry {
  const registry = new GraphNodeExecutorRegistry();

  for (const [kind, fn] of Object.entries(executorMap)) {
    registry.register(kind, { execute: fn });
  }

  if (extra) {
    for (const [kind, executor] of Object.entries(extra)) {
      registry.register(kind, executor);
    }
  }

  return registry;
}

/**
 * Builds a {@link GraphExecutionEngineConfig} populated with all demo executors
 * including loop executors that need a back-reference to the engine.
 *
 * @returns A config object ready for `new GraphExecutionEngine(config)`.
 */
export function createDemoEngineConfig(): {
  registry: GraphNodeExecutorRegistry;
  defaultOptions: { failFast: boolean };
  onEngineCreated: (engine: GraphExecutionEngine) => void;
} {
  const registry = createGraphExecutorRegistry();

  return {
    registry,
    defaultOptions: { failFast: false },
    onEngineCreated: (engine: GraphExecutionEngine) => {
      registry.register("core.loop.foreach", new ForeachGraphNodeExecutor(engine));
      registry.register("core.loop.while", new WhileGraphNodeExecutor(engine));
      registry.register("core.loop.until", new UntilGraphNodeExecutor(engine));
    },
  };
}
