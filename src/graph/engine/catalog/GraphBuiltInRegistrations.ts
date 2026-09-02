import type {
  GraphExecutionValues,
  GraphNodeExecutionRequest,
} from "../types";
import type { GraphNodeExecutor } from "../execution/GraphNodeExecutor";
import type { GraphExecutionContext } from "../execution/GraphExecutionContext";
import { GraphExecutionEngine } from "../execution/GraphExecutionEngine";
import {
  BreakGraphNodeExecutor,
  CodeGraphNodeExecutor,
  LogGraphNodeExecutor,
  SwitchGraphNodeExecutor,
} from "../execution";
import {
  ForeachGraphNodeExecutor,
  UntilGraphNodeExecutor,
  WhileGraphNodeExecutor,
} from "../loops";
import { GRAPH_BUILT_IN_NODE_MANIFESTS_BY_KIND } from "../../shared/nodes/manifests";
import { GraphNodeCatalogue } from "./GraphNodeCatalogue";
import {
  defineGraphNode,
  type GraphNodeRegistration,
} from "./GraphNodeRegistration";

type ExecutorFn = (
  request: GraphNodeExecutionRequest,
  context: GraphExecutionContext
) => GraphExecutionValues | Promise<GraphExecutionValues>;

function executorOf(fn: ExecutorFn): GraphNodeExecutor {
  return { execute: fn };
}

function forwardOutput(
  outputKey: string,
  inputKey = "value"
): GraphNodeExecutor {
  return executorOf((request) => ({
    [outputKey]: request.inputs[inputKey] ?? request.inputs,
  }));
}

function triggerPayloadExecutor(): GraphNodeExecutor {
  return executorOf((request) => ({ payload: request.inputs["payload"] ?? null }));
}

function defaultFlowExecutors(): Record<string, GraphNodeExecutor> {
  return {
    "core.flow.map": executorOf((request) => ({
      result: { mapped: request.inputs["value"] ?? request.inputs },
    })),
    "core.flow.delay": forwardOutput("valueOut"),
    "core.flow.return": forwardOutput("result"),
    "core.flow.merge": forwardOutput("merged", "values"),
    "core.flow.if": forwardOutput("then"),
    "core.flow.parallel": executorOf((request) => ({
      branches: [request.inputs["value"] ?? request.inputs],
    })),
    "core.flow.errorBoundary": forwardOutput("result"),
    "core.flow.humanApproval": forwardOutput("approved"),
    "core.flow.break": new BreakGraphNodeExecutor(),
    "core.agent": executorOf((request) => ({
      response: `[Agent response] ${String(request.inputs["prompt"] ?? "")}`,
      actions: [],
    })),
  };
}

function defaultTriggerExecutors(): Record<string, GraphNodeExecutor> {
  return {
    "core.trigger.manual": triggerPayloadExecutor(),
    "core.trigger.webhook": triggerPayloadExecutor(),
    "core.trigger.schedule": triggerPayloadExecutor(),
    "core.trigger.event": triggerPayloadExecutor(),
    "core.trigger.form": triggerPayloadExecutor(),
    "core.trigger.chat": executorOf((request) => ({
      message: request.inputs["message"] ?? null,
      sessionId: request.inputs["sessionId"] ?? null,
      userId: request.inputs["userId"] ?? null,
    })),
  };
}

function engineBoundExecutors(
  engine: GraphExecutionEngine
): Record<string, GraphNodeExecutor> {
  return {
    "core.flow.code": new CodeGraphNodeExecutor(engine),
    "core.flow.log": new LogGraphNodeExecutor(),
    "core.utility.log": new LogGraphNodeExecutor(),
    "core.flow.switch": new SwitchGraphNodeExecutor(engine),
    "core.loop.foreach": new ForeachGraphNodeExecutor(engine),
    "core.loop.while": new WhileGraphNodeExecutor(engine),
    "core.loop.until": new UntilGraphNodeExecutor(engine),
  };
}

/**
 * Builds the built-in node registrations (DECAF-50 §4.12): every built-in
 * manifest from {@link GRAPH_BUILT_IN_NODE_MANIFESTS_BY_KIND} that has a
 * default executor, paired with that executor as a
 * {@link GraphNodeRegistration}. Engine-bound executors (loops, switch) are
 * only included when an `engine` is provided.
 */
export function builtInGraphNodeRegistrations(
  engine?: GraphExecutionEngine
): GraphNodeRegistration[] {
  const executors: Record<string, GraphNodeExecutor> = {
    ...defaultTriggerExecutors(),
    ...defaultFlowExecutors(),
    ...(engine ? engineBoundExecutors(engine) : {}),
  };
  const registrations: GraphNodeRegistration[] = [];
  for (const [kind, manifest] of Object.entries(
    GRAPH_BUILT_IN_NODE_MANIFESTS_BY_KIND
  )) {
    const executor = executors[kind];
    if (!executor) continue;
    registrations.push(defineGraphNode({ manifest, executor }));
  }
  return registrations;
}

/**
 * Registers all built-in graph nodes (see
 * {@link builtInGraphNodeRegistrations}) into the given
 * {@link GraphNodeCatalogue} and returns it for chaining.
 */
export function registerBuiltInGraphNodes(
  catalogue: GraphNodeCatalogue,
  engine?: GraphExecutionEngine
): GraphNodeCatalogue {
  for (const registration of builtInGraphNodeRegistrations(engine)) {
    catalogue.register(registration);
  }
  return catalogue;
}
