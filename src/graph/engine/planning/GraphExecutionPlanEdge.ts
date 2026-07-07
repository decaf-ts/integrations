/**
 * @module integrations/graph/planning/GraphExecutionPlanEdge
 * @summary Plan edge type for the execution plan.
 * @description Represents a directed value route between two endpoints (node-to-node or node-to-workflow-boundary).
 */

/**
 * An edge in the execution plan representing a value route from a source
 * port to a target port.
 *
 * `sourceNodeId` or `targetNodeId` may be {@link GRAPH_WORKFLOW_BOUNDARY} when
 * the edge connects to the workflow boundary.
 */
export interface GraphExecutionPlanEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
  label?: string;
  metadata?: Record<string, unknown>;
}
