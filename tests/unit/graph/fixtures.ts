/**
 * @module integrations/tests/unit/graph/fixtures
 * @summary Test fixtures for graph execution engine unit tests.
 */
import type {
  GraphNodeDefinition,
  GraphPortDefinition,
  GraphWorkflowDefinition,
  GraphWorkflowRelationMetadata,
  GraphWorkflowNodeMetadata,
} from "@decaf-ts/ui-decorators/graph";
import { PortDirection } from "@decaf-ts/ui-decorators/graph";

/**
 * Builds a minimal port definition.
 */
export function port(
  name: string,
  direction: PortDirection
): GraphPortDefinition {
  return {
    property: name,
    direction,
    name,
    label: name,
    required: false,
    hidden: false,
  };
}

/**
 * Builds a minimal node definition with the given input/output port names.
 */
export function nodeDef(
  name: string,
  kind: string,
  inputPorts: string[] = [],
  outputPorts: string[] = []
): GraphNodeDefinition {
  return {
    name,
    tag: name,
    kind,
    labels: [],
    ports: [
      ...inputPorts.map((p) => port(p, PortDirection.INPUT)),
      ...outputPorts.map((p) => port(p, PortDirection.OUTPUT)),
    ],
  };
}

/**
 * Builds a workflow node metadata entry referencing a definition.
 */
export function workflowNode(
  id: string,
  kind: string,
  definition?: GraphNodeDefinition
): GraphWorkflowNodeMetadata {
  return {
    id,
    kind,
    label: id,
    node: definition,
  };
}

/**
 * Builds a relation metadata entry.
 */
export function relation(
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string
): GraphWorkflowRelationMetadata {
  return { source, sourcePort, target, targetPort };
}

/**
 * Builds a linear two-node workflow:
 *   workflow.input -> adder -> multiplier -> workflow.output
 */
export function linearWorkflow(): GraphWorkflowDefinition {
  const adderDef = nodeDef("adder", "math.add", ["a", "b"], ["sum"]);
  const multiplierDef = nodeDef("multiplier", "math.multiply", ["x"], ["product"]);

  return {
    name: "linear-wf",
    tag: "linear-wf",
    kind: "workflow",
    labels: [],
    ports: [],
    inputs: [port("a", PortDirection.INPUT), port("b", PortDirection.INPUT)],
    outputs: [port("result", PortDirection.OUTPUT)],
    nodes: [
      workflowNode("adder", "math.add", adderDef),
      workflowNode("multiplier", "math.multiply", multiplierDef),
    ],
    relations: [
      relation("workflow", "a", "adder", "a"),
      relation("workflow", "b", "adder", "b"),
      relation("adder", "sum", "multiplier", "x"),
      relation("multiplier", "product", "workflow", "result"),
    ],
    workflow: {
      inputs: [port("a", PortDirection.INPUT), port("b", PortDirection.INPUT)],
      outputs: [port("result", PortDirection.OUTPUT)],
    },
  };
}

/**
 * Builds a cyclic workflow (adder -> multiplier -> adder) to test cycle detection.
 */
export function cyclicWorkflow(): GraphWorkflowDefinition {
  const adderDef = nodeDef("adder", "math.add", ["a"], ["sum"]);
  const multiplierDef = nodeDef("multiplier", "math.multiply", ["x"], ["product"]);

  return {
    name: "cyclic-wf",
    tag: "cyclic-wf",
    kind: "workflow",
    labels: [],
    ports: [],
    inputs: [],
    outputs: [],
    nodes: [
      workflowNode("adder", "math.add", adderDef),
      workflowNode("multiplier", "math.multiply", multiplierDef),
    ],
    relations: [
      relation("adder", "sum", "multiplier", "x"),
      relation("multiplier", "product", "adder", "a"),
    ],
    workflow: { inputs: [], outputs: [] },
  };
}
