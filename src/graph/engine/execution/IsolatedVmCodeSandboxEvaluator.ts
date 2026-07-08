/**
 * @module integrations/graph/execution/IsolatedVmCodeSandboxEvaluator
 * @summary {@link CodeSandboxEvaluator} backed by `isolated-vm` (ALFRED-5 §7).
 * @description Provides a fully isolated V8 sandbox for the Code Node
 * (DECAF-32 §22.4) and code-based conditions. Uses `isolated-vm` for true
 * heap isolation (unlike Node's `vm` module which shares the host heap),
 * `acorn` + `acorn-walk` for AST-based static validation, and `typescript`
 * for TS transpilation.
 *
 * Restrictions enforced (ALFRED-5 §7.10–7.12, DECAF-34 §7.5):
 *
 * - **No imports** — `import` declarations are rejected by AST validation.
 * - **No requires** — `require` is in the blocked-identifier set and is not
 *   exposed in the sandbox context.
 * - **No exports** — `export` declarations are rejected by AST validation.
 * - **Pure functions only** — no system API access. Blocked identifiers
 *   include `process`, `global`, `globalThis`, `Function`, `eval`, `fetch`,
 *   `XMLHttpRequest`, `WebSocket`, `Worker`, `Deno`, `Bun`, `module`,
 *   `exports`. The sandbox context exposes only the data variables
 *   (`$input`, `$vars`, `$item`, `$index`, `$node`, `$output`).
 * - **No `eval()` / `new Function()`** — rejected by AST validation.
 *
 * The user code is transpiled (TS → JS) if needed, statically validated,
 * wrapped in a strict-mode async function that receives the data variables as
 * parameters, compiled in an isolated V8 instance, and executed with a
 * timeout and memory limit. The result is copied back to the host heap.
 *
 * @example
 * ```ts
 * const evaluator = new IsolatedVmCodeSandboxEvaluator();
 * const result = await evaluator.evaluate({
 *   code: "return $input.a + $input.b;",
 *   input: { a: 2, b: 3 },
 * });
 * // result === 5
 * ```
 */
import ivm from "isolated-vm";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import * as ts from "typescript";
import type {
  CodeSandboxEvaluator,
  CodeSandboxContext,
} from "./CodeSandboxEvaluator";
import { GraphExecutionError } from "../errors/GraphExecutionError";

/**
 * Default sandbox execution timeout in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 1000;

/**
 * Default memory limit for the isolated V8 heap in MB.
 */
const DEFAULT_MEMORY_MB = 32;

/**
 * Maximum code length (characters) accepted by the evaluator.
 */
const MAX_CODE_LENGTH = 100_000;

/**
 * Identifiers that are forbidden in sandboxed code (ALFRED-5 §7.10).
 *
 * Any AST node of type `Identifier` whose `name` is in this set causes the
 * validator to reject the code. This covers both free-standing references
 * (`process.env`) and call targets (`require(...)`).
 */
const BLOCKED_IDENTIFIERS: ReadonlySet<string> = new Set([
  "process",
  "require",
  "module",
  "exports",
  "global",
  "globalThis",
  "Function",
  "eval",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "Deno",
  "Bun",
]);

/**
 * Transpiles TypeScript code to JavaScript (ALFRED-5 §7.4).
 *
 * When the language is `'javascript'` the code is returned unchanged. For
 * `'typescript'` the code is transpiled using the TypeScript compiler with
 * module kind `None` (no import/export emitted) and target `ES2022`.
 *
 * @param code - The user-authored code.
 * @param language - The code language (`'javascript'` or `'typescript'`).
 * @returns Transpiled JavaScript code.
 */
function transpileTypeScript(
  code: string,
  language: "javascript" | "typescript"
): string {
  if (language === "javascript") return code;

  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
      noEmitHelpers: true,
      importHelpers: false,
    },
  });

  // Strip the "use strict"; directive that ts.transpileModule adds — the
  // sandbox wrapper already enforces strict mode, and the directive breaks
  // expression-mode wrapping (return (...)).
  return result.outputText.replace(/^"use strict";\s*/, "");
}

/**
 * Statically validates user code using an AST walk (ALFRED-5 §7.11).
 *
 * Rejects:
 * - `ImportDeclaration` — no imports allowed.
 * - `ExportNamedDeclaration` / `ExportDefaultDeclaration` — no exports.
 * - `Identifier` whose name is in {@link BLOCKED_IDENTIFIERS}.
 * - `NewExpression` with callee `Function` — no `new Function()`.
 * - `CallExpression` with callee `eval` — no `eval()`.
 *
 * @param code - JavaScript code to validate (after TS transpilation).
 * @throws {GraphExecutionError} when a forbidden construct is found.
 */
function validateSafeCode(code: string): void {
  if (code.length > MAX_CODE_LENGTH) {
    throw new GraphExecutionError(
      `Code exceeds the maximum length of ${MAX_CODE_LENGTH} characters`,
      "GRAPH_CODE_SANDBOX_CODE_TOO_LONG",
      { length: code.length }
    );
  }

  let ast: acorn.AnyNode;
  try {
    // First, try parsing the code wrapped in a function with sourceType
    // "script". This handles `return` statements (which are valid inside a
    // function) and lets us detect blocked identifiers, eval(), and
    // new Function() via the AST walk.
    ast = acorn.parse(`async function __validate() {\n${code}\n}`, {
      ecmaVersion: "latest",
      sourceType: "script",
    }) as acorn.AnyNode;
  } catch {
    // If the function-wrapped parse fails (e.g. because the code has
    // top-level `import` or `export` declarations which are invalid inside
    // a function), try parsing the raw code with sourceType "module" so
    // import/export declarations are recognised as AST nodes.
    try {
      ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
      }) as acorn.AnyNode;
    } catch (err) {
      throw new GraphExecutionError(
        `Code failed to parse: ${(err as Error).message}`,
        "GRAPH_CODE_SANDBOX_PARSE_ERROR",
        { code, error: (err as Error).message }
      );
    }
  }

  walk.full(ast as never, (node: acorn.AnyNode) => {
    const n = node as unknown as Record<string, unknown>;

    if (n["type"] === "ImportDeclaration") {
      throw new GraphExecutionError(
        "Imports are not allowed in Code nodes.",
        "GRAPH_CODE_SANDBOX_FORBIDDEN_TOKEN",
        { token: "import" }
      );
    }

    if (
      n["type"] === "ExportNamedDeclaration" ||
      n["type"] === "ExportDefaultDeclaration"
    ) {
      throw new GraphExecutionError(
        "Exports are not allowed in Code nodes.",
        "GRAPH_CODE_SANDBOX_FORBIDDEN_TOKEN",
        { token: "export" }
      );
    }

    if (
      n["type"] === "Identifier" &&
      typeof n["name"] === "string" &&
      BLOCKED_IDENTIFIERS.has(n["name"])
    ) {
      throw new GraphExecutionError(
        `Identifier "${n["name"]}" is not allowed in Code nodes.`,
        "GRAPH_CODE_SANDBOX_FORBIDDEN_TOKEN",
        { token: n["name"] }
      );
    }

    if (
      n["type"] === "NewExpression" &&
      (n["callee"] as Record<string, unknown>)?.["name"] === "Function"
    ) {
      throw new GraphExecutionError(
        "new Function() is not allowed in Code nodes.",
        "GRAPH_CODE_SANDBOX_FORBIDDEN_TOKEN",
        { token: "Function" }
      );
    }

    if (
      n["type"] === "CallExpression" &&
      (n["callee"] as Record<string, unknown>)?.["name"] === "eval"
    ) {
      throw new GraphExecutionError(
        "eval() is not allowed in Code nodes.",
        "GRAPH_CODE_SANDBOX_FORBIDDEN_TOKEN",
        { token: "eval" }
      );
    }
  });
}

/**
 * Determines whether the given code contains a top-level `return` statement.
 *
 * When the code has no `return`, it is treated as a single expression and
 * wrapped in `return (...)` so the user can write `($input.a + $input.b)`
 * instead of `return $input.a + $input.b`.
 */
function hasReturnStatement(code: string): boolean {
  return /\breturn\b[\s;]/.test(code);
}

/**
 * `isolated-vm`-backed {@link CodeSandboxEvaluator} (ALFRED-5 §7.18).
 *
 * This evaluator provides a truly isolated V8 sandbox — the code runs in a
 * separate isolate with its own heap, separate from the host process. The
 * sandbox context exposes only the data variables (`$input`, `$vars`, `$item`,
 * `$index`, `$node`, `$output`); no host globals are available.
 *
 * Execution pipeline:
 * 1. **Transpile** — TypeScript code is transpiled to JavaScript via
 *    `typescript.transpileModule` (ALFRED-5 §7.4).
 * 2. **Validate** — the JavaScript code is parsed with `acorn` and walked with
 *    `acorn-walk` to reject imports, exports, blocked identifiers, `eval()`,
 *    and `new Function()` (ALFRED-5 §7.11).
 * 3. **Isolate** — a new `isolated-vm` `Isolate` is created with a memory
 *    limit. A context is created and the data variables are copied into the
 *    isolate's heap via `ExternalCopy`.
 * 4. **Compile & run** — the wrapped code is compiled and executed with a
 *    timeout. The result is copied back to the host heap.
 * 5. **Dispose** — the isolate is always disposed in a `finally` block.
 *
 * The user code is wrapped in a strict-mode async function:
 *
 * ```js
 * "use strict";
 * async function __userFunction($input, $vars, $item, $index, $node, $output) {
 *   <user code>
 * }
 * __userFunction($input, $vars, $item, $index, $node, $output);
 * ```
 *
 * When the code has no `return` statement it is treated as a single expression
 * and wrapped in `return (...)`.
 */
export class IsolatedVmCodeSandboxEvaluator implements CodeSandboxEvaluator {
  private readonly defaultTimeoutMs: number;
  private readonly defaultMemoryMb: number;

  /**
   * @param defaultTimeoutMs - Default execution timeout in milliseconds.
   * @param defaultMemoryMb - Default isolate memory limit in MB.
   */
  constructor(
    defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS,
    defaultMemoryMb: number = DEFAULT_MEMORY_MB
  ) {
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.defaultMemoryMb = defaultMemoryMb;
  }

  async evaluate(ctx: CodeSandboxContext): Promise<unknown> {
    const code = ctx.code;
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      throw new GraphExecutionError(
        "Code sandbox received empty code",
        "GRAPH_CODE_SANDBOX_EMPTY_CODE"
      );
    }

    const language = ctx.language ?? "javascript";
    const jsCode = transpileTypeScript(code, language);

    validateSafeCode(jsCode);

    const expressionMode = !hasReturnStatement(jsCode);
    const codeForMode = expressionMode
      ? jsCode.replace(/[\s;]+$/, "")
      : jsCode;

    const sandboxVars: Record<string, unknown> = {
      $input: ctx.input ?? {},
      $vars: ctx.vars ?? {},
      $item: ctx.item,
      $index: ctx.index,
      $node: ctx.nodes ?? {},
      $output: undefined,
    };

    const paramNames = Object.keys(sandboxVars);
    // const paramValues = Object.values(sandboxVars);

    // Build the wrapped script. The user code runs inside an async function
    // with named parameters. The result is JSON-stringified inside the isolate
    // so it can be transferred back as a plain string (isolated-vm cannot
    // deep-copy arbitrary objects via `script.run()` with `promise: true`).
    // The spec requires JSON-serializable output, so this is safe.
    const userBody = expressionMode ? `return (${codeForMode});` : codeForMode;
    const wrapped = `"use strict";\nasync function __userFunction(${paramNames.join(", ")}) {\n${userBody}\n}\n__userFunction(${paramNames.join(", ")}).then(function(__r) { return JSON.stringify({ v: __r }); });`;

    const isolate = new ivm.Isolate({ memoryLimit: this.defaultMemoryMb });
    const context = await isolate.createContext();

    try {
      const jail = context.global;

      for (const [name, value] of Object.entries(sandboxVars)) {
        await jail.set(
          name,
          new ivm.ExternalCopy(value === undefined ? null : value).copyInto()
        );
      }

      let script: ivm.Script;
      try {
        script = await isolate.compileScript(wrapped, {
          filename: "graph-code-node.js",
        });
      } catch (err) {
        if (expressionMode) {
          const fallbackBody = codeForMode;
          const fallbackWrapped = `"use strict";\nasync function __userFunction(${paramNames.join(", ")}) {\n${fallbackBody}\n}\n__userFunction(${paramNames.join(", ")}).then(function(__r) { return JSON.stringify({ v: __r }); });`;
          try {
            script = await isolate.compileScript(fallbackWrapped, {
              filename: "graph-code-node.js",
            });
          } catch (fallbackErr) {
            throw new GraphExecutionError(
              `Code failed to compile: ${(fallbackErr as Error).message}`,
              "GRAPH_CODE_SANDBOX_COMPILE_ERROR",
              { code: jsCode, error: (fallbackErr as Error).message }
            );
          }
        } else {
          throw new GraphExecutionError(
            `Code failed to compile: ${(err as Error).message}`,
            "GRAPH_CODE_SANDBOX_COMPILE_ERROR",
            { code: jsCode, error: (err as Error).message }
          );
        }
      }

      let rawResult: unknown;
      try {
        rawResult = await script.run(context, {
          timeout: this.defaultTimeoutMs,
          promise: true,
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("timed out") || msg.includes("timeout")) {
          throw new GraphExecutionError(
            `Code execution timed out after ${this.defaultTimeoutMs} ms`,
            "GRAPH_CODE_SANDBOX_TIMEOUT",
            { timeoutMs: this.defaultTimeoutMs }
          );
        }
        if (msg.includes("memory") || msg.includes("heap")) {
          throw new GraphExecutionError(
            `Code exceeded the memory limit of ${this.defaultMemoryMb} MB`,
            "GRAPH_CODE_SANDBOX_MEMORY_LIMIT",
            { memoryMb: this.defaultMemoryMb }
          );
        }
        throw new GraphExecutionError(
          `Code execution failed: ${msg}`,
          "GRAPH_CODE_SANDBOX_RUNTIME_ERROR",
          { code: jsCode, error: msg }
        );
      }

      // The script returns a JSON string `{"v": <result>}`. Parse it back.
      if (typeof rawResult !== "string") {
        throw new GraphExecutionError(
          "Code sandbox returned an unexpected non-string result",
          "GRAPH_CODE_SANDBOX_UNEXPECTED_RESULT",
          { result: rawResult }
        );
      }
      return JSON.parse(rawResult).v;
    } finally {
      context.release();
      isolate.dispose();
    }
  }
}
