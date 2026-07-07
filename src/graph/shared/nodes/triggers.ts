/**
 * @module integrations/graph/nodes/triggers
 * @summary Production trigger node kind declarations (DECAF-32 §22.2.1).
 * @description Canonical `@node`-decorated classes for the six ALFRED-5 trigger
 * kinds. Triggers are metadata-only entrypoints: they define how a workflow
 * starts and produce a trigger payload on their `@output` ports. They have no
 * `@input` ports (nothing feeds a trigger) and no built-in executors — the
 * engine's execution model starts from workflow inputs (§5.8) and treats
 * trigger nodes as metadata-only entrypoints.
 */
import { Model, model, required } from "@decaf-ts/decorator-validation";
import { uielement } from "@decaf-ts/ui-decorators";
import { node, output } from "@decaf-ts/ui-decorators/graph";

/**
 * Manual trigger — user clicks Run; input form generated from `inputSchema`.
 */
@node("core.trigger.manual", {
  kind: "core.trigger.manual",
  category: "Trigger",
  color: "#3b82f6",
  icon: "ti-hand-click",
  width: 96,
  height: 96,
  labels: ["trigger", "manual", "entrypoint"],
  metadata: {
    title: "Manual trigger",
    description: "Starts the workflow when the user clicks Run. The input form is generated from the trigger's input schema.",
    trigger: {
      type: "manual",
      inputSchema: {},
    },
  },
})
@model()
export class ManualTriggerNode extends Model {
  @required()
  @uielement("textarea", { label: "Trigger payload", placeholder: "Manual trigger payload" })
  @output({ handle: "payload" })
  payload!: unknown;
}

/**
 * Webhook trigger — HTTP request received; path/method/auth/responseMode config.
 */
@node("core.trigger.webhook", {
  kind: "core.trigger.webhook",
  category: "Trigger",
  color: "#0ea5e9",
  icon: "ti-webhook",
  width: 96,
  height: 96,
  labels: ["trigger", "webhook", "http"],
  metadata: {
    title: "Webhook trigger",
    description: "Starts the workflow when an HTTP request is received on the configured path and method.",
    trigger: {
      type: "webhook",
      path: "/webhook",
      method: "POST",
      auth: "none",
      responseMode: "onReceived",
    },
  },
})
@model()
export class WebhookTriggerNode extends Model {
  @required()
  @uielement("textarea", { label: "Request payload", placeholder: "Webhook request body" })
  @output({ handle: "payload" })
  payload!: unknown;
}

/**
 * Schedule trigger — cron-like schedule; timezone + payload config.
 */
@node("core.trigger.schedule", {
  kind: "core.trigger.schedule",
  category: "Trigger",
  color: "#6366f1",
  icon: "ti-calendar-time",
  width: 96,
  height: 96,
  labels: ["trigger", "schedule", "cron"],
  metadata: {
    title: "Schedule trigger",
    description: "Starts the workflow on a cron-like schedule with timezone support.",
    trigger: {
      type: "schedule",
      schedule: "0 * * * *",
      timezone: "UTC",
    },
  },
})
@model()
export class ScheduleTriggerNode extends Model {
  @required()
  @uielement("textarea", { label: "Scheduled payload", placeholder: "Payload for the scheduled run" })
  @output({ handle: "payload" })
  payload!: unknown;
}

/**
 * Event trigger — internal event bus topic subscriber.
 */
@node("core.trigger.event", {
  kind: "core.trigger.event",
  category: "Trigger",
  color: "#8b5cf6",
  icon: "ti-broadcast",
  width: 96,
  height: 96,
  labels: ["trigger", "event", "bus"],
  metadata: {
    title: "Event trigger",
    description: "Starts the workflow when an event is published on the configured internal event bus topic.",
    trigger: {
      type: "event",
      topic: "default",
    },
  },
})
@model()
export class EventTriggerNode extends Model {
  @required()
  @uielement("textarea", { label: "Event payload", placeholder: "Event bus payload" })
  @output({ handle: "payload" })
  payload!: unknown;
}

/**
 * Form trigger — generated public/internal form; field definitions.
 */
@node("core.trigger.form", {
  kind: "core.trigger.form",
  category: "Trigger",
  color: "#ec4899",
  icon: "ti-forms",
  width: 96,
  height: 96,
  labels: ["trigger", "form", "public"],
  metadata: {
    title: "Form trigger",
    description: "Starts the workflow when a generated form is submitted. Field definitions drive the form schema.",
    trigger: {
      type: "form",
      fields: [],
    },
  },
})
@model()
export class FormTriggerNode extends Model {
  @required()
  @uielement("textarea", { label: "Form submission", placeholder: "Form submission payload" })
  @output({ handle: "payload" })
  payload!: unknown;
}

/**
 * Chat trigger — chat message entrypoint; message/sessionId/userId schema.
 */
@node("core.trigger.chat", {
  kind: "core.trigger.chat",
  category: "Trigger",
  color: "#14b8a6",
  icon: "ti-message-circle",
  width: 96,
  height: 96,
  labels: ["trigger", "chat", "entrypoint"],
  metadata: {
    title: "Chat trigger",
    description: "Starts the workflow when a chat message is received. Emits message, sessionId, and userId.",
    trigger: {
      type: "chat",
    },
  },
})
@model()
export class ChatTriggerNode extends Model {
  @required()
  @uielement("input", { label: "Message", placeholder: "Incoming chat message" })
  @output({ handle: "message" })
  message!: string;

  @required()
  @uielement("input", { label: "Session ID", placeholder: "Chat session identifier" })
  @output({ handle: "sessionId" })
  sessionId!: string;

  @required()
  @uielement("input", { label: "User ID", placeholder: "Chat user identifier" })
  @output({ handle: "userId" })
  userId!: string;
}

/**
 * All built-in trigger node constructors.
 */
export const GRAPH_TRIGGER_NODES = [
  ManualTriggerNode,
  WebhookTriggerNode,
  ScheduleTriggerNode,
  EventTriggerNode,
  FormTriggerNode,
  ChatTriggerNode,
] as const;
