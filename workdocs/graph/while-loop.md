# While Loop

Iterate with a condition using the `while` loop node.

## Definition

```typescript
import { GraphWorkflowDefinition, PortDirection, GRAPH_LOOP_KIND } from "@decaf-ts/ui-decorators/graph";
import { GraphConditionType } from "@decaf-ts/integrations/graph";

const bodyWorkflow: GraphWorkflowDefinition = {
  name: "increment",
  tag: "increment",
  kind: "workflow",
  labels: [],
  ports: [],
  inputs: [{ property: "count", direction: PortDirection.INPUT, name: "count", label: "count", required: false, hidden: false }],
  outputs: [{ property: "count", direction: PortDirection.OUTPUT, name: "count", label: "count", required: false, hidden: false }],
  nodes: [
    { id: "inc", kind: "math.increment", label: "Increment" },
  ],
  relations: [
    { source: "workflow", sourcePort: "count", target: "inc", targetPort: "x" },
    { source: "inc", sourcePort: "out", target: "workflow", targetPort: "count" },
  ],
  workflow: { inputs: [], outputs: [] },
};

const workflow: GraphWorkflowDefinition = {
  name: "while-example",
  tag: "while-example",
  kind: "workflow",
  labels: [],
  ports: [],
  inputs: [{ property: "start", direction: PortDirection.INPUT, name: "start", label: "start", required: false, hidden: false }],
  outputs: [{ property: "finalCount", direction: PortDirection.OUTPUT, name: "finalCount", label: "finalCount", required: false, hidden: false }],
  nodes: [
    {
      id: "loop",
      kind: GRAPH_LOOP_KIND.WHILE,
      label: "Count to 10",
      metadata: {
        loop: {
          body: bodyWorkflow,
          statePort: "count",
          inputPort: "start",
          outputPort: "finalCount",
          condition: {
            type: GraphConditionType.LESS_THAN,
            left: "count",
            right: 10,
          },
          maxIterations: 100,
        },
      },
    },
  ],
  relations: [
    { source: "workflow", sourcePort: "start", target: "loop", targetPort: "start" },
    { source: "loop", sourcePort: "finalCount", target: "workflow", targetPort: "finalCount" },
  ],
  workflow: { inputs: [], outputs: [] },
};
```

## Condition Types

| Type | Description |
|------|-------------|
| `truthy` | Left value is truthy |
| `falsy` | Left value is falsy |
| `equals` | Left === right |
| `notEquals` | Left !== right |
| `greaterThan` | Number(left) > Number(right) |
| `greaterThanOrEqual` | Number(left) >= Number(right) |
| `lessThan` | Number(left) < Number(right) |
| `lessThanOrEqual` | Number(left) <= Number(right) |
| `exists` | Left is not null/undefined |

## Execution

```typescript
import { GraphExecutionEngine, GraphNodeExecutorRegistry, WhileGraphNodeExecutor } from "@decaf-ts/integrations/graph";

const registry = new GraphNodeExecutorRegistry();
registry.register("math.increment", { execute: (i) => ({ out: Number(i.x) + 1 }) });
registry.register(GRAPH_LOOP_KIND.WHILE, new WhileGraphNodeExecutor(engine));

const engine = new GraphExecutionEngine({ registry });
const result = await engine.execute(workflow, { start: 0 });

console.log(result.outputs.finalCount); // 10
```

## Safety

The engine enforces `maxIterations` (default: 100) and emits a `loop.limitReached` event if the limit is hit, preventing infinite loops.
