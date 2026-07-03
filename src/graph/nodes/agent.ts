/**
 * @module integrations/graph/nodes/agent
 * @summary Production Agent node declaration.
 * @description The Agent node is the primary AI agent entrypoint. It is a
 * rectangular node with `@connection()` ports for its structural dependencies:
 * `model` (the LLM), `memory` (the memory store), and `workspace` (the
 * workspace/context). Connections are rendered on the bottom side of the node
 * (DECAF-32 §21.3). Each connection category has a distinct color defined in
 * the category style registry.
 */
import { Model, model, required } from "@decaf-ts/decorator-validation";
import { uielement } from "@decaf-ts/ui-decorators";
import { connection, input, node, output } from "@decaf-ts/ui-decorators/graph";

// Ensure category styles are registered (idempotent).
import "./category-styles";

/**
 * Agent node — an AI agent that orchestrates a model, memory, and workspace.
 *
 * The agent has:
 * - `@input` ports on the **left**: `instructions` (the task prompt), `context`
 *   (additional context data).
 * - `@output` ports on the **right**: `response` (the agent's output), `actions`
 *   (any actions the agent decided to take).
 * - `@connection` ports on the **bottom**: `model` (LLM), `memory` (memory
 *   store), `workspace` (workspace/context). Each connection has a distinct
 *   category color.
 *
 * The node is rectangular (not rounded) to visually distinguish it from
 * regular processing nodes. The `color` and `icon` are omitted from `@node()`
 * so they are resolved from the `"Agent"` category style.
 */
@node("core.agent", {
  kind: "core.agent",
  category: "Agent",
  // color and icon omitted — resolved from the "Agent" category style
  width: 120,
  height: 140,
  labels: ["agent", "ai", "orchestrator"],
  metadata: {
    title: "Agent",
    description:
      "AI agent that orchestrates a model, memory, and workspace to complete a task.",
    shape: "rectangle",
  },
})
@model()
export class AgentNode extends Model {
  // --- Inputs (left side) ---

  @required()
  @uielement("textarea", { label: "Instructions", placeholder: "Task instructions for the agent" })
  @input({ handle: "instructions" })
  instructions!: string;

  @required()
  @uielement("textarea", { label: "Context", placeholder: "Additional context data" })
  @input({ handle: "context" })
  context!: unknown;

  // --- Outputs (right side) ---

  @required()
  @uielement("textarea", { label: "Response", placeholder: "Agent response" })
  @output({ handle: "response" })
  response!: string;

  @required()
  @uielement("textarea", { label: "Actions", placeholder: "Actions taken by the agent" })
  @output({ handle: "actions" })
  actions!: unknown[];

  // --- Connections (bottom side) ---

  @required()
  @uielement("input", { label: "Model", placeholder: "LLM model connection" })
  @connection({ category: "model", handle: "model" })
  model!: unknown;

  @required()
  @uielement("input", { label: "Memory", placeholder: "Memory store connection" })
  @connection({ category: "memory", handle: "memory" })
  memory!: unknown;

  @required()
  @uielement("input", { label: "Workspace", placeholder: "Workspace connection" })
  @connection({ category: "workspace", handle: "workspace" })
  workspace!: unknown;
}

/**
 * All built-in agent node constructors.
 */
export const GRAPH_AGENT_NODES = [AgentNode] as const;
