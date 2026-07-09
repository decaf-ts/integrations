/**
 * @module integrations/nest/graph/GraphExecutorRegistryFactory
 * @summary Factory that builds a populated {@link GraphNodeExecutorRegistry}.
 * @description Creates a registry pre-loaded with the demo executors used by
 * the graph execution backend's sample workflows. The executors cover the
 * flow-control kinds (including Code, Log, and Switch with code conditions),
 * the agent kind, and the loop kinds. Additional executors can be registered
 * on the returned registry before it is handed to the
 * {@link GraphExecutionEngine}.
 */
import {
  GraphNodeExecutorRegistry,
  GraphExecutionEngine,
  type GraphNodeExecutor,
  type GraphExecutionContext,
  type GraphExecutionValues,
  ForeachGraphNodeExecutor,
  WhileGraphNodeExecutor,
  UntilGraphNodeExecutor,
  CodeGraphNodeExecutor,
  LogGraphNodeExecutor,
  SwitchGraphNodeExecutor,
  IsolatedVmCodeSandboxEvaluator,
} from "../../graph";

type ExecutorFn = (
  input: GraphExecutionValues,
  context: GraphExecutionContext,
) => GraphExecutionValues | Promise<GraphExecutionValues>;

const executorMap: Record<string, ExecutorFn> = {
  "math.add": (input) => ({ sum: Number(input.a) + Number(input.b) }),
  "math.multiply": (input) => ({ product: Number(input.x) * 2 }),
  "core.flow.map": (input) => ({ result: { mapped: input["value"] ?? input } }),
  "core.flow.delay": (input) => ({ valueOut: input["value"] ?? input }),
  "core.flow.return": (input) => ({ result: input["value"] ?? input }),
  "core.flow.merge": (input) => ({ merged: input["values"] ?? input }),
  "core.flow.if": (input) => ({ then: input["value"] ?? input }),
  "core.flow.parallel": (input) => ({ branches: [input["value"] ?? input] }),
  "core.flow.errorBoundary": (input) => ({ result: input["value"] ?? input }),
  "core.flow.humanApproval": (input) => ({ approved: input["value"] ?? input }),
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
 * - `core.flow.*` — flow-control kinds (map, delay, return, merge, if,
 *   parallel, errorBoundary, humanApproval). The `core.flow.code`,
 *   `core.flow.log`, and `core.flow.switch` kinds are registered in
 *   `onEngineCreated` via their real executors because Code and Switch
 *   need the engine's `codeSandboxEvaluator`.
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
 * including loop executors that need a back-reference to the engine and the
 * Code node executor that needs the engine's `codeSandboxEvaluator`.
 *
 * The config wires an {@link IsolatedVmCodeSandboxEvaluator} (backed by
 * `isolated-vm`) so the Code Node runs in a truly isolated V8 sandbox.
 *
 * @returns A config object ready for `new GraphExecutionEngine(config)`.
 */
export function createDemoEngineConfig(): {
  registry: GraphNodeExecutorRegistry;
  defaultOptions: { failFast: boolean };
  codeSandboxEvaluator: IsolatedVmCodeSandboxEvaluator;
  onEngineCreated: (engine: GraphExecutionEngine) => void;
} {
  const registry = createGraphExecutorRegistry();
  const codeSandboxEvaluator = new IsolatedVmCodeSandboxEvaluator();

  return {
    registry,
    defaultOptions: { failFast: false },
    codeSandboxEvaluator,
    onEngineCreated: (engine: GraphExecutionEngine) => {
      registry.register("core.loop.foreach", new ForeachGraphNodeExecutor(engine));
      registry.register("core.loop.while", new WhileGraphNodeExecutor(engine));
      registry.register("core.loop.until", new UntilGraphNodeExecutor(engine));
      registry.register("core.flow.code", new CodeGraphNodeExecutor(engine));
      registry.register("core.flow.log", new LogGraphNodeExecutor());
      registry.register("core.flow.switch", new SwitchGraphNodeExecutor(engine));
    },
  };
}
