/**
 * @module integrations/graph/nodes/base
 * @summary Base class for graph node declarations.
 * @description `GraphNode` extends {@link Model} with an overridable
 * `applyMetadata` static method. Concrete node kinds that support dynamic
 * metadata changes (e.g. `SwitchFlowNode` adding case output ports) override
 * this method to compute their own ports, size, and data patches — the node
 * is exclusively responsible for itself in every way.
 */
import { Model } from "@decaf-ts/decorator-validation";
import type { NodeMetadataChange } from "../types";

export class GraphNode extends Model {
  /**
   * Applies a metadata patch to this node class, returning the resulting
   * ports, size, and data patches.
   *
   * The default implementation returns `null` (no changes). Concrete node
   * kinds that support dynamic metadata override this to compute their own
   * ports and size from the metadata — the caller (renderer) simply relays
   * the result to the diagram model.
   *
   * @param _meta - The metadata patch (node-kind-specific, e.g.
   *   `SwitchNodeMetadata`).
   * @returns The computed change, or `null` when the node kind does not
   *   support dynamic metadata.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static applyMetadata(_meta: unknown): NodeMetadataChange | null {
    return null;
  }
}
