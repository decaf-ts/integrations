# Foreach Loop

Iterate over a collection using the `foreach` loop node.

## Definition

```typescript
import { GraphWorkflowDefinition, PortDirection, GRAPH_LOOP_KIND } from "@decaf-ts/ui-decorators/graph";

const bodyWorkflow: GraphWorkflowDefinition = {
  name: "double-item",
  tag: "double-item",
  kind: "workflow",
  labels: [],
  ports: [],
  inputs: [{ property: "item", direction: PortDirection.INPUT, name: "item", label: "item", required: false, hidden: false }],
  outputs: [{ property: "result", direction: PortDirection.OUTPUT, name: "result", label: "result", required: false, hidden: false }],
  nodes: [
    { id: "doubler", kind: "math.double", label: "Doubler" },
  ],
  relations: [
    { source: "workflow", sourcePort: "item", target: "doubler", targetPort: "x" },
    { source: "doubler", sourcePort: "out", target: "workflow", targetPort: "result" },
  ],
  workflow: { inputs: [], outputs: [] },
};

const workflow: GraphWorkflowDefinition = {
  name: "foreach-example",
  tag: "foreach-example",
  kind: "workflow",
  labels: [],
  ports: [],
  inputs: [{ property: "items", direction: PortDirection.INPUT, name: "items", label: "items", required: false, hidden: false }],
  outputs: [{ property: "results", direction: PortDirection.OUTPUT, name: "results", label: "results", required: false, hidden: false }],
  nodes: [
    {
      id: "loop",
      kind: GRAPH_LOOP_KIND.FOREACH,
      label: "Double each",
      metadata: {
        loop: {
          body: bodyWorkflow,
          itemPort: "item",
          resultPort: "result",
          inputPort: "items",
          outputPort: "results",
        },
      },
    },
  ],
  relations: [
    { source: "workflow", sourcePort: "items", target: "loop", targetPort: "items" },
    { source: "loop", sourcePort: "results", target: "workflow", targetPort: "results" },
  ],
  workflow: { inputs: [], outputs: [] },
};
```

## Execution

```typescript
import { GraphExecutionEngine, GraphNodeExecutorRegistry, ForeachGraphNodeExecutor } from "@decaf-ts/integrations/graph";

const registry = new GraphNodeExecutorRegistry();
registry.register("math.double", { execute: (i) => ({ out: Number(i.x) * 2 }) });
registry.register(GRAPH_LOOP_KIND.FOREACH, new ForeachGraphNodeExecutor(engine));

const engine = new GraphExecutionEngine({ registry });
const result = await engine.execute(workflow, { items: [1, 2, 3] });

console.log(result.outputs.results); // [2, 4, 6]
```

## Events

The engine emits `loop.started`, `loop.iteration.started` (with `iteration` number), `loop.iteration.completed`, and `loop.completed` events for each foreach loop node.
