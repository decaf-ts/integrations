/**
 * @module integrations/graph/nodes/utility/map
 * @summary Map utility node declaration (DECAF-32 §22.2.2).
 * @description Map — transforms the current input into a new output object.
 */
import { Model, model, required } from "@decaf-ts/decorator-validation";
import { uielement } from "@decaf-ts/ui-decorators";
import { input, node, output } from "@decaf-ts/ui-decorators/graph";
import { GraphNode } from "../base";
import type {
  GraphExecutionValues,
  GraphNodeExecutionRequest,
} from "../../engine/types";


@node("core.flow.map", {
  kind: "core.flow.map",
  category: "Utility",
  color: "#0d9488",
  icon: "ti-arrows-right-left",
  width: 96,
  height: 96,
  labels: ["flow", "map", "transform"],
  metadata: {
    title: "Map",
    description: "Transforms the current input into a new output object using the configured mapper.",
    mapper: {},
  },
})
@model()
export class MapFlowNode extends GraphNode {
  static execute(
    request: GraphNodeExecutionRequest
  ): GraphExecutionValues {
    return { result: { mapped: request.inputs["value"] ?? request.inputs } };
  }

  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to transform" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Transformed output", placeholder: "Mapped result" })
  @output({ handle: "result" })
  result!: unknown;
}
