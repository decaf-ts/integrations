/**
 * @module integrations/graph/validation/GraphDefinitionValidator
 * @summary Validates graph workflow definitions before execution.
 * @description Checks workflow structure, node IDs, relation endpoints/ports, required port sources, cycles, and loop metadata.
 */
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import { GraphInputError } from "../errors/GraphInputError";
import { GraphExecutionPlanner } from "../planning/GraphExecutionPlanner";

/**
 * Validates a {@link GraphWorkflowDefinition} before execution.
 */
export class GraphDefinitionValidator {
  private readonly planner: GraphExecutionPlanner;

  constructor(planner?: GraphExecutionPlanner) {
    this.planner = planner ?? new GraphExecutionPlanner();
  }

  /**
   * Validates the workflow definition.
   *
   * @throws {GraphInputError} when the workflow has no name or invalid structure.
   * @throws {GraphCycleError} when the workflow contains an unsupported cycle.
   */
  validate(workflow: GraphWorkflowDefinition): void {
    if (!workflow.name) {
      throw new GraphInputError("Workflow must have a name");
    }

    const nodeIds = new Set((workflow.nodes ?? []).map((n) => n.id));
    if (nodeIds.size !== (workflow.nodes ?? []).length) {
      throw new GraphInputError("Workflow node IDs must be unique");
    }

    // The planner performs full topology validation (endpoints, ports, cycles)
    this.planner.plan(workflow);
  }
}
