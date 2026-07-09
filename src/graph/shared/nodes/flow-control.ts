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
import { uielement, hidden } from "@decaf-ts/ui-decorators";
import {
  graphDefinitionOf,
  input,
  node,
  output,
  PortDirection,
  type GraphPortDefinition,
} from "@decaf-ts/ui-decorators/graph";
import type { NodeMetadataChange, SwitchNodeMetadata } from "../types";
import { GraphNode } from "./base";

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
      hasDefault: false,
    },
  },
})
@model()
export class SwitchFlowNode extends GraphNode {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to switch on" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Default", placeholder: "Default output when no case matches" })
  @output({ handle: "default" })
  default!: unknown;

  /**
   * Computes the node's ports, size, and data patch from the given switch
   * metadata. Each case gets its own output port on the right side; the
   * `default` port always renders **last** (DECAF-32 §21 port-ordering rule,
   * DECAF-34 §6.2). When `hasDefault` is `false`, the `default` output port
   * is omitted entirely. The node grows in height as cases are added.
   */
  static override applyMetadata(meta: SwitchNodeMetadata): NodeMetadataChange {
    const definition = graphDefinitionOf(this as never);
    const defaultPortName = meta.defaultPort ?? "default";
    const hasDefault = meta.hasDefault === true;

    // Base ports excluding any port that collides with a case output port.
    const basePorts = definition.ports.filter(
      (p) => !meta.cases.some((c) => c.outputPort === p.property)
    );
    // Separate the default output port so it can be placed last (or omitted).
    const nonDefaultPorts = basePorts.filter(
      (p) => p.property !== defaultPortName
    );
    const defaultPort = basePorts.find((p) => p.property === defaultPortName);

    const casePorts: GraphPortDefinition[] = meta.cases.map((c) => ({
      property: c.outputPort,
      name: c.label,
      direction: PortDirection.OUTPUT,
      label: c.label,
      required: false,
      hidden: false,
      path: c.outputPort,
    }));

    // Port order: inputs/non-default outputs first, case outputs next, default last.
    const ports = [...nonDefaultPorts, ...casePorts];
    if (hasDefault && defaultPort) {
      ports.push(defaultPort);
    }

    const caseCount = meta.cases.length;
    return {
      ports,
      size: {
        width: definition.width ?? 120,
        height: caseCount > 0 ? 140 + caseCount * 24 : definition.height ?? 140,
      },
      dataPatch: { switchMetadata: meta },
    };
  }
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
 * Code — sandboxed JS/TS code execution (ALFRED-5 §7, DECAF-32 §22.4).
 *
 * The engine's {@link CodeGraphNodeExecutor} delegates to the pluggable
 * {@link CodeSandboxEvaluator}. The default
 * `IsolatedVmCodeSandboxEvaluator` (backed by `isolated-vm`) enforces the
 * Code Node restrictions: no imports, no requires, pure functions only. The
 * sandbox context exposes `$input`, `$vars`, `$item`, `$index`, `$node`, and
 * `$output` as data variables. TypeScript is supported via transpilation.
 */

/**
 * Input schema for the Code node. The `@input` on `CodeFlowNode.input` is a
 * schema group — the nested model's `@input` ports are spliced into the
 * parent unprefixed. `code` has `@input` + `@uielement("code-editor")`, so it
 * appears as a port AND in the CRUD modal (the only visible field). `data`
 * has `@input` + `@hidden()` but no `@uielement`, so it is a canvas-only port
 * (for edge connections from workflow input badges) but never appears in the
 * CRUD modal. `language` has no `@input` and no `@uielement`, so it is
 * neither a port nor rendered — it defaults to `"javascript"`.
 */
@model()
export class CodeInputSchema extends Model {
  @required()
  language: string = "javascript";

  @required()
  @uielement("code-editor", { label: "Code", placeholder: "// User-authored JS code" })
  @input({ handle: "code" })
  code!: string;

  @hidden()
  @input({ handle: "data" })
  data?: unknown;
}

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
    timeoutMs: 1000,
  },
})
@model()
export class CodeFlowNode extends Model {
  @required()
  @input({ handle: "input", model: CodeInputSchema })
  input!: CodeInputSchema;

  @required()
  @output({ handle: "result" })
  result!: unknown;
}

/**
 * Log — logs the input value and forwards it unchanged on the `logged`
 * output port. Useful for debugging, audit trails, and discard/side-effect
 * branches in a workflow.
 */
@node("core.flow.log", {
  kind: "core.flow.log",
  category: "Utility",
  color: "#6366f1",
  icon: "ti-terminal",
  width: 96,
  height: 96,
  labels: ["flow", "log", "debug", "utility"],
  metadata: {
    title: "Log",
    description: "Logs the input value to the execution logger and forwards it unchanged.",
  },
})
@model()
export class LogFlowNode extends Model {
  @required()
  @uielement("textarea", { label: "Input value", placeholder: "Value to log" })
  @input({ handle: "value" })
  value!: unknown;

  @required()
  @uielement("input", { label: "Logged value", placeholder: "Forwarded value" })
  @output({ handle: "logged" })
  logged!: unknown;
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
  LogFlowNode,
] as const;
