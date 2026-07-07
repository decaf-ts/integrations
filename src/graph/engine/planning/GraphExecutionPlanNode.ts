/**
 * @module integrations/graph/planning/GraphExecutionPlanNode
 * @summary Plan node type for the execution plan.
 * @description Represents a single node resolved from a workflow definition, ready for execution.
 */
import type {
  GraphNodeDefinition,
  GraphWorkflowNodeMetadata,
} from "@decaf-ts/ui-decorators/graph";

/**
 * A node in the execution plan, derived from a workflow's node metadata and
 * its resolved graph definition.
 */
export interface GraphExecutionPlanNode {
  id: string;
  kind: string;
  label?: string;
  source: GraphWorkflowNodeMetadata;
  definition: GraphNodeDefinition;
  inputPorts: string[];
  outputPorts: string[];
  metadata?: Record<string, unknown>;
}
