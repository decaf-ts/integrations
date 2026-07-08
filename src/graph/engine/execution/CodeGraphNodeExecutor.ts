/**
 * @module integrations/graph/execution/CodeGraphNodeExecutor
 * @summary Executor for the Code flow-control node (DECAF-32 §22.4, DECAF-34 §7.5).
 * @description Executes user-authored JS/TS in a restricted sandbox via the
 * pluggable {@link CodeSandboxEvaluator}. The sandbox enforces the Code Node
 * restrictions: no imports, no requires, pure functions only (no system API
 * access). The executor reads the code, language, and timeout from the node's
 * graph metadata, resolves the sandbox context from the node's input values
 * and execution context, invokes the evaluator, and returns the result on the
 * `result` output port.
 */
import type { GraphNodeExecutor } from "./GraphNodeExecutor";
import type { GraphExecutionContext } from "./GraphExecutionContext";
import type { CodeSandboxEvaluator, CodeSandboxContext } from "./CodeSandboxEvaluator";
import type { GraphExecutionValues } from "../types";
import { GraphExecutionError } from "../errors/GraphExecutionError";
import { GraphInputError } from "../errors/GraphInputError";

/**
 * Metadata stored on a Code node's `graph.metadata` field.
 */
interface CodeNodeMetadata {
  code?: string;
  language?: "javascript" | "typescript";
  timeoutMs?: number;
  outputSchema?: unknown;
}

/**
 * Reads the Code node metadata from the node definition's graph metadata.
 */
function readCodeMetadata(context: GraphExecutionContext): CodeNodeMetadata {
  const meta = context.node.graph?.metadata as
    | Record<string, unknown>
    | undefined;
  if (!meta) return {};
  const codeMeta = meta["code"] as CodeNodeMetadata | undefined;
  if (!codeMeta) return {};
  return codeMeta;
}

/**
 * Executor for `core.flow.code` nodes.
 *
 * The Code Node runs user-authored JS/TS in a restricted sandbox. The engine
 * does not implement the sandbox directly (§22.4); instead it delegates to the
 * pluggable {@link CodeSandboxEvaluator} registered on the engine config. When
 * no evaluator is registered, the executor throws
 * `GRAPH_CODE_SANDBOX_NOT_CONFIGURED`.
 *
 * The sandbox context exposes:
 * - `$input` — the value on the node's `input` port (or the full input object
 *   as a fallback when no `input` port is present).
 * - `$vars` — workflow variables (sourced from `context.metadata.vars` when
 *   the engine populates it).
 * - `$item` / `$index` — current loop item and index (sourced from
 *   `context.metadata` when the node executes inside a foreach body).
 * - `$node` — outputs of upstream nodes (sourced from
 *   `context.metadata.nodes` when available).
 * - `$output` — the current draft output (sourced from
 *   `context.metadata.output`).
 *
 * The evaluator's return value is forwarded verbatim on the `result` output
 * port.
 */
export class CodeGraphNodeExecutor implements GraphNodeExecutor {
  /**
   * @param engine - The graph execution engine (or any object exposing the
   *   optional `codeSandboxEvaluator`). This mirrors the pattern used by
   *   {@link SwitchGraphNodeExecutor} for code conditions.
   */
  constructor(
    private readonly engine?: { codeSandboxEvaluator?: CodeSandboxEvaluator }
  ) {}

  async execute(
    input: GraphExecutionValues,
    context: GraphExecutionContext
  ): Promise<GraphExecutionValues> {
    const meta = readCodeMetadata(context);
    const code = meta.code;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      throw new GraphInputError(
        "Code node has no code to execute (metadata.code is empty)",
        { metadata: meta }
      );
    }

    const evaluator = this.engine?.codeSandboxEvaluator;
    if (!evaluator) {
      throw new GraphExecutionError(
        "Code node execution requires a CodeSandboxEvaluator to be registered in GraphExecutionEngineConfig.codeSandboxEvaluator",
        "GRAPH_CODE_SANDBOX_NOT_CONFIGURED",
        { code }
      );
    }

    const sandboxContext = this.buildSandboxContext(input, context, meta);

    await context.log("Executing code node", {
      language: meta.language ?? "javascript",
      length: code.length,
    });

    const result = await evaluator.evaluate(sandboxContext);

    await context.log("Code node executed", { hasResult: result !== undefined });

    return { result };
  }

  /**
   * Builds the {@link CodeSandboxContext} from the executor input and the
   * graph execution context.
   *
   * The `$input` value is resolved from the node's `input` port. When the node
   * has no explicit `input` port, the full input values object is used as
   * `$input` so the code can still access every resolved port value.
   *
   * The `$vars`, `$item`, `$index`, `$node`, and `$output` values are sourced
   * from `context.metadata` — the engine (or a wrapping loop executor) may
   * populate these when the Code node runs inside a loop body or a workflow
   * with variables.
   */
  private buildSandboxContext(
    input: GraphExecutionValues,
    context: GraphExecutionContext,
    meta: CodeNodeMetadata
  ): CodeSandboxContext {
    const inputPortValue = "input" in input ? input["input"] : input;
    const md = context.metadata as Record<string, unknown> | undefined;

    return {
      code: meta.code!,
      language: meta.language ?? "javascript",
      input:
        typeof inputPortValue === "object" && inputPortValue !== null
          ? (inputPortValue as Record<string, unknown>)
          : { value: inputPortValue },
      vars: (md?.vars as Record<string, unknown> | undefined) ?? undefined,
      item: md?.item,
      index: md?.index as number | undefined,
      nodes:
        (md?.nodes as Record<string, Record<string, unknown>> | undefined) ??
        undefined,
    };
  }
}
