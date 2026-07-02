# Pinnable Nodes

Cache and pin node outputs to skip re-execution on subsequent runs.

## Marking a Node Pinnable

Use the `@pinnable()` decorator on a graph node class:

```typescript
import { pinnable } from "@decaf-ts/ui-decorators/graph";

@pinnable()
class ExpensiveComputation {
  // ...
}
```

With options:

```typescript
@pinnable({ strategy: "automatic", ttlMs: 60000, includeDependencies: true })
class CachedNode {
  // ...
}
```

## Pinning After Execution

After a successful run, pin a node and its upstream dependencies:

```typescript
import { GraphExecutionEngine, GraphNodeExecutorRegistry } from "@decaf-ts/integrations/graph";

const engine = new GraphExecutionEngine({ registry });

const result = await engine.execute(workflow, { a: 2, b: 3 });

// Pin the "merge" node — all upstream deps (A, B) are pinned too
await engine.pinNode({
  workflow,
  plan: result.plan, // plan from the execution
  result,
  nodeId: "merge",
  includeDependencies: true,
});
```

Pinning is **all-or-nothing**: if any upstream dependency is not marked `@pinnable()`, the operation fails with a `GraphPinningError`.

## Cache Hit on Next Run

On the next execution, the engine checks for pinned values before calling the executor:

```typescript
const result2 = await engine.execute(workflow, { a: 2, b: 3 });

// The "merge" node was served from cache — no executor called
console.log(result2.nodeResults.merge.fromCache); // true
console.log(result2.nodeResults.merge.pinned);    // true
```

The fingerprint is computed from:
- Workflow ID
- Node ID and kind
- Input values (stable-serialized with sorted keys)
- Upstream dependency fingerprints (recursive)

Changing any input or upstream output invalidates the cache automatically.

## Unpinning

```typescript
await engine.unpinNode({
  workflow,
  nodeId: "merge",
  fingerprint: "fp_abc123_42", // from the pinning metadata
});
```

## Custom Value Store Adapter

By default, the engine uses `InMemoryGraphValueStoreAdapter` (values lost on restart). To persist across restarts, implement `GraphValueStoreAdapter`:

```typescript
import type { GraphValueStoreAdapter, GraphValueKey, GraphCachedValue } from "@decaf-ts/integrations/graph";

class RedisGraphValueStoreAdapter implements GraphValueStoreAdapter {
  async read(key: GraphValueKey): Promise<GraphCachedValue | undefined> {
    // Read from Redis using serialized key
  }
  async write(key: GraphValueKey, value: GraphCachedValue): Promise<void> {
    // Write to Redis
  }
  async delete(key: GraphValueKey): Promise<void> {
    // Delete from Redis
  }
  async has(key: GraphValueKey): Promise<boolean> {
    // Check existence
  }
  async list(prefix: Partial<GraphValueKey>): Promise<GraphCachedValue[]> {
    // List matching entries
  }
  async clearRun(runId: string): Promise<void> {
    // Clear all values for a run
  }
}

const engine = new GraphExecutionEngine({
  registry,
  valueStoreAdapter: new RedisGraphValueStoreAdapter(),
});
```

## Pinning Strategies

| Strategy | Behavior |
|----------|----------|
| `manual` | Pin only when `engine.pinNode()` is called explicitly |
| `automatic` | Engine auto-pins after successful execution |
| `disabled` | Pinning and cache reads are disabled |
