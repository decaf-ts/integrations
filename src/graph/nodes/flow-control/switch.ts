/**
 * @module integrations/graph/nodes/flow-control/switch
 * @summary Switch flow-control node declaration (DECAF-32 §22.2.2).
 * @description Switch — multi-branch. Routes the input to one of the case
 * output ports or `default` based on matching conditions. Each case defines
 * a `SwitchCaseCondition` (graphical or code mode) and a dedicated output
 * port. Cases are stored in `metadata.switch.cases` and the renderer creates
 * dynamic output ports from them (DECAF-32 §22.2.2).
 *
 * The node grows in height as cases are added. Each case gets its own
 * output port on the right side, labeled with the case label.
 */
import { model, required } from "@decaf-ts/decorator-validation";
import { uielement } from "@decaf-ts/ui-decorators";
import {
  input,
  node,
  output,
} from "@decaf-ts/ui-decorators/graph";
import {
  PortDirection,
  graphNodeSizeOf,
  type GraphPortDefinition,
} from "@decaf-ts/ui-decorators/graph";
import { graphDefinitionOf } from "@decaf-ts/ui-decorators/graph";
import type {
  NodeMetadataChange,
  SwitchNodeMetadata,
  SwitchCaseCondition,
  ConditionExpression,
  CodeCondition,
} from "@decaf-ts/ui-decorators/graph";
import { GraphNode } from "../base";
import type { GraphExecutionContext } from "../../engine/execution/GraphExecutionContext";
import type {
  GraphExecutionValues,
  GraphNodeExecutionRequest,
} from "../../engine/types";
import type {
  CodeSandboxEvaluator,
  SandboxLogger,
} from "../../engine/execution/CodeSandboxEvaluator";
import { GraphExecutionError } from "../../engine/errors/GraphExecutionError";
import { ConditionExpressionEvaluator } from "../../engine/loops/ConditionExpressionEvaluator";


function readSwitchMetadata(context: GraphExecutionContext): SwitchNodeMetadata {
  const parameters = (context.node.parameters ?? {}) as Record<string, unknown>;
  const metadata = context.node.metadata as Record<string, unknown> | undefined;
  const raw = parameters["switch"] ?? metadata?.["switch"];
  const switchMeta = raw as SwitchNodeMetadata | undefined;
  if (!switchMeta || !Array.isArray(switchMeta.cases)) {
    return { cases: [], defaultPort: "default", hasDefault: false };
  }
  return {
    cases: switchMeta.cases,
    defaultPort: switchMeta.defaultPort ?? "default",
    hasDefault: switchMeta.hasDefault === true,
  };
}

function isCodeCondition(cond: SwitchCaseCondition): cond is CodeCondition {
  return (
    typeof cond === "object" && cond !== null && "type" in cond && cond.type === "code"
  );
}

function isConditionExpression(
  cond: SwitchCaseCondition
): cond is ConditionExpression {
  return (
    typeof cond === "object" && cond !== null && "op" in cond && typeof cond.op === "string"
  );
}

async function evaluateSwitchCondition(
  condition: SwitchCaseCondition,
  inputValue: unknown,
  fullInput: GraphExecutionValues,
  context: GraphExecutionContext
): Promise<boolean> {
  if (isCodeCondition(condition)) {
    const evaluator = (
      context.engine as { codeSandboxEvaluator?: CodeSandboxEvaluator } | undefined
    )?.codeSandboxEvaluator;
    if (!evaluator) {
      throw new GraphExecutionError(
        "Code conditions require a CodeSandboxEvaluator to be registered in GraphExecutionEngineConfig.codeSandboxEvaluator",
        "GRAPH_CODE_SANDBOX_NOT_CONFIGURED",
        { code: condition.code }
      );
    }
    await context.log("Evaluating code condition", {
      language: condition.language ?? "javascript",
    });
    const md = context.metadata as Record<string, unknown> | undefined;
    const result = await evaluator.evaluate({
      code: condition.code,
      language: condition.language,
      input: fullInput,
      vars: (md?.vars as Record<string, unknown> | undefined) ?? undefined,
      item: md?.item,
      index: md?.index as number | undefined,
      nodes:
        (md?.nodes as Record<string, Record<string, unknown>> | undefined) ??
        undefined,
      logger: context.logger as unknown as SandboxLogger | undefined,
    });
    return !!result;
  }
  if (isConditionExpression(condition)) {
    return new ConditionExpressionEvaluator().evaluate(condition, inputValue);
  }
  throw new GraphExecutionError(
    "Unknown switch case condition type — must be ConditionExpression (op) or CodeCondition (type: 'code')",
    "GRAPH_UNKNOWN_SWITCH_CONDITION",
    { condition }
  );
}

@node("core.flow.switch", {
  kind: "core.flow.switch",
  category: "Flow Control",
  color: "#f59e0b",
  icon: "ti-arrows-shuffle",
  width: 120,
  height: 140,
  sizeRules: [
    {
      type: "parameterCount",
      parameter: "cases",
      dimension: "height",
      perItem: 24,
    },
  ],
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
  static async execute(
    request: GraphNodeExecutionRequest,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const meta = readSwitchMetadata(context);
    const input = request.inputs;
    const inputValue = input["value"] ?? input;

    for (const switchCase of meta.cases) {
      const matches = await evaluateSwitchCondition(
        switchCase.condition,
        inputValue,
        input,
        context
      );
      if (matches) {
        return { [switchCase.outputPort]: inputValue };
      }
    }

    if (meta.hasDefault !== true) {
      throw new GraphExecutionError(
        "No switch case matched and default port is not enabled",
        "GRAPH_SWITCH_NO_MATCH",
        { cases: meta.cases.map((c) => c.id) }
      );
    }
    const defaultPort = meta.defaultPort ?? "default";
    return { [defaultPort]: inputValue };
  }

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
   *
   * @param meta - The switch metadata patch (`metadata.switch`), carrying
   *   the cases and the optional default-port configuration.
   * @returns The computed {@link NodeMetadataChange}: reordered ports
   *   (case outputs inserted before the optional default), the grown size,
   *   and the `switchMetadata` data patch.
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
      size: graphNodeSizeOf(definition, { cases: caseCount }),
      dataPatch: { switchMetadata: meta },
    };
  }
}
