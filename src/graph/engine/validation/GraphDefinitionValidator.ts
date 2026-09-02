/**
 * @module integrations/graph/validation/GraphDefinitionValidator
 * @summary Legacy structural checks for decorated workflow definitions.
 * @description Kept for the §4.18 transition. Full workflow validation moved
 * to the nine-stage document gate ({@link GraphWorkflowDocumentValidator});
 * this shim only performs the cheap structural checks that do not require
 * catalogue resolution.
 */
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import { GraphInputError } from "../errors/GraphInputError";

/**
 * Performs cheap structural checks on a legacy {@link GraphWorkflowDefinition}.
 *
 * @deprecated Validate canonical documents with
 *   {@link GraphWorkflowDocumentValidator} instead.
 */
export class GraphDefinitionValidator {
  /**
   * Validates the workflow definition structure.
   *
   * @throws {GraphInputError} when the workflow has no name or duplicate node ids.
   */
  validate(workflow: GraphWorkflowDefinition): void {
    if (!workflow.name) {
      throw new GraphInputError("Workflow must have a name");
    }

    const nodeIds = new Set((workflow.nodes ?? []).map((n) => n.id));
    if (nodeIds.size !== (workflow.nodes ?? []).length) {
      throw new GraphInputError("Workflow node IDs must be unique");
    }
  }
}
