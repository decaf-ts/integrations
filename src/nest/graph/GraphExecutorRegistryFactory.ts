/**
 * @module integrations/nest/graph/GraphExecutorRegistryFactory
 * @summary Factory that builds a populated {@link GraphNodeExecutorRegistry}.
 * @description Creates a registry pre-loaded with the demo executors (`math.add`, `math.multiply`) used by the graph execution backend's sample workflows. Additional executors can be registered on the returned registry before it is handed to the {@link GraphExecutionEngine}.
 */
import { GraphNodeExecutorRegistry } from "../../graph";
import type { GraphNodeExecutor } from "../../graph";

/**
 * Builds a {@link GraphNodeExecutorRegistry} populated with the demo executors.
 *
 * Registered kinds:
 * - `math.add` — sums `a` and `b` into `sum`.
 * - `math.multiply` — multiplies `x` by 2 into `product`.
 *
 * @returns A populated registry ready for use with {@link GraphExecutionEngine}.
 */
export function createGraphExecutorRegistry(
  extra?: Record<string, GraphNodeExecutor>
): GraphNodeExecutorRegistry {
  const registry = new GraphNodeExecutorRegistry();

  registry.register("math.add", {
    execute: (input) => ({ sum: Number(input.a) + Number(input.b) }),
  });
  registry.register("math.multiply", {
    execute: (input) => ({ product: Number(input.x) * 2 }),
  });

  if (extra) {
    for (const [kind, executor] of Object.entries(extra)) {
      registry.register(kind, executor);
    }
  }

  return registry;
}
