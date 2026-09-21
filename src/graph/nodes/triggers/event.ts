/**
 * @module integrations/graph/nodes/triggers/event
 * @summary Event trigger node declaration (DECAF-32 §22.2.1).
 * @description Event trigger — internal event bus topic subscriber.
 */
import { model, required } from "@decaf-ts/decorator-validation";
import { uielement } from "@decaf-ts/ui-decorators";
import { node, output } from "@decaf-ts/ui-decorators/graph";
import { GraphNode } from "../base";
import type {
  GraphExecutionValues,
  GraphNodeExecutionRequest,
} from "../../engine/types";

@node("core.trigger.event", {
  kind: "core.trigger.event",
  category: "Trigger",
  color: "#3b82f6",
  icon: "ti-broadcast",
  width: 96,
  height: 96,
  labels: ["trigger", "event", "bus"],
  metadata: {
    title: "Event trigger",
    description:
      "Starts the workflow when an event is published on the configured internal event bus topic.",
    trigger: {
      type: "event",
      topic: "default",
    },
  },
})
@model()
export class EventTriggerNode extends GraphNode {
  static execute(request: GraphNodeExecutionRequest): GraphExecutionValues {
    return { payload: request.inputs["payload"] ?? null };
  }

  @required()
  @uielement("textarea", {
    label: "Event payload",
    placeholder: "Event bus payload",
  })
  @output({ handle: "payload" })
  payload!: unknown;
}
