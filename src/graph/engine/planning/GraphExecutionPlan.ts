/**
 * @module integrations/graph/planning/GraphExecutionPlan
 * @summary The complete execution plan for a workflow.
 * @description Contains resolved nodes, edges, topological layers, and incoming/outgoing maps.
 */
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";
import type { GraphExecutionPlanNode } from "./GraphExecutionPlanNode";
import type { GraphExecutionPlanEdge } from "./GraphExecutionPlanEdge";
import type { GraphExecutionPlanLayer } from "./GraphExecutionPlanLayer";

/**
 * The resolved execution plan for a single workflow.
 */
export interface GraphExecutionPlan {
  workflow: GraphWorkflowDefinition;
  workflowId: string;
  nodes: GraphExecutionPlanNode[];
  edges: GraphExecutionPlanEdge[];
  layers: GraphExecutionPlanLayer[];
  incomingByNode: Map<string, GraphExecutionPlanEdge[]>;
  outgoingByNode: Map<string, GraphExecutionPlanEdge[]>;
}
