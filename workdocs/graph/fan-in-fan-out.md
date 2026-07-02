# Fan-in / Fan-out

A workflow where multiple inputs converge into one node (fan-in) and one node feeds multiple outputs (fan-out).

## Definition

```
A ─┐
   ├─► C ─┬─► D
B ─┘      └─► E
```

```typescript
import { GraphWorkflowDefinition, PortDirection } from "@decaf-ts/ui-decorators/graph";

const workflow: GraphWorkflowDefinition = {
  name: "fan-in-out",
  tag: "fan-in-out",
  kind: "workflow",
  labels: [],
  ports: [],
  inputs: [
    { property: "a", direction: PortDirection.INPUT, name: "a", label: "a", required: false, hidden: false },
    { property: "b", direction: PortDirection.INPUT, name: "b", label: "b", required: false, hidden: false },
  ],
  outputs: [
    { property: "d", direction: PortDirection.OUTPUT, name: "d", label: "d", required: false, hidden: false },
    { property: "e", direction: PortDirection.OUTPUT, name: "e", label: "e", required: false, hidden: false },
  ],
  nodes: [
    { id: "A", kind: "src.a", label: "A" },
    { id: "B", kind: "src.b", label: "B" },
    { id: "C", kind: "merge", label: "C" },
    { id: "D", kind: "sink.d", label: "D" },
    { id: "E", kind: "sink.e", label: "E" },
  ],
  relations: [
    { source: "workflow", sourcePort: "a", target: "A", targetPort: "in" },
    { source: "workflow", sourcePort: "b", target: "B", targetPort: "in" },
    { source: "A", sourcePort: "out", target: "C", targetPort: "a" },
    { source: "B", sourcePort: "out", target: "C", targetPort: "b" },
    { source: "C", sourcePort: "result", target: "D", targetPort: "in" },
    { source: "C", sourcePort: "result", target: "E", targetPort: "in" },
    { source: "D", sourcePort: "out", target: "workflow", targetPort: "d" },
    { source: "E", sourcePort: "out", target: "workflow", targetPort: "e" },
  ],
  workflow: { inputs: [], outputs: [] },
};
```

## Execution

```typescript
import { GraphExecutionEngine, GraphNodeExecutorRegistry } from "@decaf-ts/integrations/graph";

const registry = new GraphNodeExecutorRegistry();
registry.register("src.a", { execute: (i) => ({ out: i.in }) });
registry.register("src.b", { execute: (i) => ({ out: i.in }) });
registry.register("merge", { execute: (i) => ({ result: Number(i.a) + Number(i.b) }) });
registry.register("sink.d", { execute: (i) => ({ out: i.in }) });
registry.register("sink.e", { execute: (i) => ({ out: i.in * 10 }) });

const engine = new GraphExecutionEngine({ registry });
const result = await engine.execute(workflow, { a: 2, b: 3 });

console.log(result.outputs.d); // 5
console.log(result.outputs.e); // 50
```

## Topological Layers

The planner assigns:
- **Layer 0**: A, B (no executable-node dependencies)
- **Layer 1**: C (depends on A and B)
- **Layer 2**: D, E (both depend on C — executed concurrently)
