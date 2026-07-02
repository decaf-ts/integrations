# Basic Workflow

A minimal graph workflow: workflow input -> single node -> workflow output.

## Definition

```typescript
import { GraphWorkflowDefinition, PortDirection } from "@decaf-ts/ui-decorators/graph";

const workflow: GraphWorkflowDefinition = {
  name: "double",
  tag: "double",
  kind: "workflow",
  labels: [],
  ports: [],
  inputs: [{ property: "x", direction: PortDirection.INPUT, name: "x", label: "x", required: false, hidden: false }],
  outputs: [{ property: "result", direction: PortDirection.OUTPUT, name: "result", label: "result", required: false, hidden: false }],
  nodes: [
    { id: "doubler", kind: "math.double", label: "Doubler" },
  ],
  relations: [
    { source: "workflow", sourcePort: "x", target: "doubler", targetPort: "x" },
    { source: "doubler", sourcePort: "out", target: "workflow", targetPort: "result" },
  ],
  workflow: { inputs: [], outputs: [] },
};
```

## Execution

```typescript
import { GraphExecutionEngine, GraphNodeExecutorRegistry } from "@decaf-ts/integrations/graph";

const registry = new GraphNodeExecutorRegistry();
registry.register("math.double", {
  execute: (input) => ({ out: Number(input.x) * 2 }),
});

const engine = new GraphExecutionEngine({ registry });
const result = await engine.execute(workflow, { x: 21 });

console.log(result.outputs.result); // 42
```

## Events

Subscribe to the engine's observable to receive structured events:

```typescript
engine.observe({
  refresh: async (event) => {
    console.log(event.type, event.nodeId);
  },
});
```

Event sequence for this workflow:
1. `workflow.started`
2. `workflow.planned`
3. `node.started` (doubler)
4. `node.completed` (doubler)
5. `workflow.completed`
