/**
 * @module integrations/graph/nodes/flow-control
 * @summary Production flow-control node kind declarations (DECAF-32 §22.2.2).
 * @description Canonical `@node`-decorated classes for the ten ALFRED-5
 * flow-control kinds. These are graph-level macros: the engine's planner
 * recognises them as ordinary executable nodes (§5.7) but they have no
 * built-in executors — downstream projects (e.g. ALFRED) register custom
 * executors or compile them into Mastra composition APIs (§22.2.2).
 *
 * The three loop kinds (`core.loop.foreach/while/until`) already have built-in
 * executors (§5.9) and are NOT redeclared here.
 */
import { Model, model, required } from "@decaf-ts/decorator-validation";
import { uielement } from "@decaf-ts/ui-decorators";
import { input, node, output } from "@decaf-ts/ui-decorators/graph";

/**
 * If — conditional branch. Evaluates a `ConditionExpression` (§22.3) and
 * routes the input to the `then` or `else` output.
 */
@node("core.flow.if", {
  kind: "core.flow.if",
  category: "Flow Control",
  color: "#f59e0b",
  icon: "ti-arrows-split-2",
  width: 96,
  height: 96,
  labels: ["flow", "conditional", "branch"],
  metadata: {
    title: "If",
    description: "Conditional branch. Evaluates the configured condition and routes the input to the matching output.",
    condition: { op: "eq", left: { const: true }, right: { const: true } },
  },
})
@model()
export class IfFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to evaluate" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Then", placeholder: "Output when condition is true" })
  @output({ handle: "then" })
  then!: unknown;

  @required()
  @uielement("input", { label: "Else", placeholder: "Output when condition is false" })
  @output({ handle: "else" })
  else!: unknown;
}

/**
 * Switch — multi-branch. Routes the input to one of the case output ports
 * or `default` based on matching conditions. Each case defines a
 * {@link SwitchCaseCondition} (graphical or code mode) and a dedicated
 * output port. Cases are stored in `metadata.switch.cases` and the
 * renderer creates dynamic output ports from them (DECAF-32 §22.2.2).
 *
 * The node grows in height as cases are added. Each case gets its own
 * output port on the right side, labeled with the case label.
 */
@node("core.flow.switch", {
  kind: "core.flow.switch",
  category: "Flow Control",
  color: "#f97316",
  icon: "ti-arrows-shuffle",
  width: 120,
  height: 140,
  labels: ["flow", "switch", "multi-branch"],
  metadata: {
    title: "Switch",
    description: "Multi-branch switch. Routes the input to the first matching case output, or the default output.",
    switch: {
      cases: [],
      defaultPort: "default",
    },
  },
})
@model()
export class SwitchFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to switch on" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Default", placeholder: "Default output when no case matches" })
  @output({ handle: "default" })
  default!: unknown;
}

/**
 * Parallel — splits execution into concurrent branches.
 */
@node("core.flow.parallel", {
  kind: "core.flow.parallel",
  category: "Flow Control",
  color: "#06b6d4",
  icon: "ti-arrows-vertical",
  width: 96,
  height: 96,
  labels: ["flow", "parallel", "concurrent"],
  metadata: {
    title: "Parallel",
    description: "Splits execution into concurrent branches. All branches run in parallel and outputs are collected.",
    branchCount: 2,
  },
})
@model()
export class ParallelFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to fan out" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Branches", placeholder: "Collected branch outputs" })
  @output({ handle: "branches" })
  branches!: unknown[];
}

/**
 * Merge — normalises branch/parallel outputs into a single output.
 */
@node("core.flow.merge", {
  kind: "core.flow.merge",
  category: "Utility",
  color: "#0d9488",
  icon: "ti-arrows-merge",
  width: 96,
  height: 96,
  labels: ["flow", "merge", "join"],
  metadata: {
    title: "Merge",
    description: "Merges multiple branch outputs into a single normalised output object.",
    strategy: "concat",
  },
})
@model()
export class MergeFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Branch outputs", placeholder: "Outputs to merge" })
  @input({ handle: "values" })
  values!: unknown[];

  @required()
  @uielement("input", { label: "Merged output", placeholder: "Merged result" })
  @output({ handle: "merged" })
  merged!: unknown;
}

/**
 * Map — transforms the current input into a new output object.
 */
@node("core.flow.map", {
  kind: "core.flow.map",
  category: "Utility",
  color: "#84cc16",
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
export class MapFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to transform" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Transformed output", placeholder: "Mapped result" })
  @output({ handle: "result" })
  result!: unknown;
}

/**
 * Delay — pauses execution for a configured duration.
 */
@node("core.flow.delay", {
  kind: "core.flow.delay",
  category: "Utility",
  color: "#a3a3a3",
  icon: "ti-clock-hour-4",
  width: 96,
  height: 96,
  labels: ["flow", "delay", "wait"],
  metadata: {
    title: "Delay",
    description: "Pauses execution for the configured duration (in milliseconds), then forwards the input unchanged.",
    durationMs: 1000,
  },
})
@model()
export class DelayFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to forward after delay" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Output value", placeholder: "Forwarded value" })
  @output({ handle: "value" })
  valueOut!: unknown;
}

/**
 * Error boundary — try/catch/finally workflow behaviour.
 */
@node("core.flow.errorBoundary", {
  kind: "core.flow.errorBoundary",
  category: "Flow Control",
  color: "#ef4444",
  icon: "ti-shield-check",
  width: 96,
  height: 96,
  labels: ["flow", "error", "try-catch"],
  metadata: {
    title: "Error boundary",
    description: "Wraps the input in a try/catch/finally. Emits the result on success, or the error on failure.",
    finally: false,
  },
})
@model()
export class ErrorBoundaryFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to guard" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Result", placeholder: "Output on success" })
  @output({ handle: "result" })
  result!: unknown;

  @required()
  @uielement("input", { label: "Error", placeholder: "Output on failure" })
  @output({ handle: "error" })
  error!: unknown;
}

/**
 * Human approval — suspends execution until a human approves or rejects.
 */
@node("core.flow.humanApproval", {
  kind: "core.flow.humanApproval",
  category: "Flow Control",
  color: "#d946ef",
  icon: "ti-user-check",
  width: 96,
  height: 96,
  labels: ["flow", "approval", "suspend"],
  metadata: {
    title: "Human approval",
    description: "Suspends execution until a human approves or rejects. Emits the approved value or a rejection.",
    approvers: [],
    timeoutMs: 86400000,
  },
})
@model()
export class HumanApprovalFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value pending approval" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Approved", placeholder: "Output when approved" })
  @output({ handle: "approved" })
  approved!: unknown;

  @required()
  @uielement("input", { label: "Rejected", placeholder: "Output when rejected" })
  @output({ handle: "rejected" })
  rejected!: unknown;
}

/**
 * Return — defines and normalises the final workflow output.
 */
@node("core.flow.return", {
  kind: "core.flow.return",
  category: "Utility",
  color: "#22c55e",
  icon: "ti-arrow-back-up",
  width: 96,
  height: 96,
  labels: ["flow", "return", "output"],
  metadata: {
    title: "Return",
    description: "Normalises the input into the final workflow output object.",
    outputSchema: {},
  },
})
@model()
export class ReturnFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to normalise" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Returned output", placeholder: "Normalised output" })
  @output({ handle: "result" })
  result!: unknown;
}

/**
 * Code — sandboxed JS/TS code execution (ALFRED-5 §7).
 *
 * The engine does not implement the sandbox directly (§22.4). A future
 * executor may wrap the `CodeSandbox` contract (ALFRED-5 §7.17) as a
 * pluggable executor. The placeholder syntax (`{{ $input }}`, `{{ $item }}`,
 * `{{ $index }}`, `{{ $vars }}`, `{{ $node["Name"].output }}`) is Mastra-
 * agnostic and lives in the downstream project's `modules/core` (ALFRED-6).
 */
@node("core.flow.code", {
  kind: "core.flow.code",
  category: "Utility",
  color: "#7c3aed",
  icon: "ti-code",
  width: 96,
  height: 96,
  labels: ["flow", "code", "sandbox", "transform"],
  metadata: {
    title: "Code",
    description: "Runs user-authored JS/TS in a restricted VM sandbox. Supports placeholder syntax for workflow data references.",
    code: "",
    language: "javascript",
  },
})
@model()
export class CodeFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input", placeholder: "Input object (accessible as $input)" })
  @input({ handle: "input" })
  input!: unknown;

  @required()
  @uielement("input", { label: "Result", placeholder: "Code execution result" })
  @output({ handle: "result" })
  result!: unknown;
}

/**
 * All built-in flow-control node constructors.
 */
export const GRAPH_FLOW_CONTROL_NODES = [
  IfFlowNode,
  SwitchFlowNode,
  ParallelFlowNode,
  MergeFlowNode,
  MapFlowNode,
  DelayFlowNode,
  ErrorBoundaryFlowNode,
  HumanApprovalFlowNode,
  ReturnFlowNode,
  CodeFlowNode,
] as const;
