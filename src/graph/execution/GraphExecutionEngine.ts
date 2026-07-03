/**
 * @module integrations/graph/execution/GraphExecutionEngine
 * @summary Reference graph execution engine.
 * @description Executes graph workflows declared with `@decaf-ts/ui-decorators/graph`, emits events through Decaf's Observable pipeline, supports parallel node execution within topological layers, and returns a complete execution result.
 */
import type { Observable } from "@decaf-ts/core";
import type { GraphWorkflowDefinition } from "@decaf-ts/ui-decorators/graph";

import {
  GRAPH_DEFAULT_CONCURRENCY,
  GRAPH_WORKFLOW_BOUNDARY,
  GraphExecutionEventType,
  GraphExecutionStatus,
} from "../constants";
import type {
  GraphExecutionErrorPayload,
  GraphExecutionEvent,
  GraphExecutionOptions,
  GraphExecutionResult,
  GraphExecutionValues,
  GraphNodeExecutionResult,
  GraphPinNodeOptions,
  GraphUnpinNodeOptions,
  GraphRunId,
} from "../types";
import type { GraphExecutionObserver } from "../events/GraphExecutionObserver";
import { GraphExecutionEventEmitter } from "../events/GraphExecutionEventEmitter";
import { GraphExecutionEventFactory } from "../events/GraphExecutionEventFactory";
import type { GraphNodeExecutorRegistry } from "../registry/GraphNodeExecutorRegistry";
import { GraphExecutionPlanner } from "../planning/GraphExecutionPlanner";
import type { GraphExecutionPlan } from "../planning/GraphExecutionPlan";
import type { GraphExecutionPlanNode } from "../planning/GraphExecutionPlanNode";
import type { GraphValueStoreAdapter } from "../store/GraphValueStoreAdapter";
import { InMemoryGraphValueStoreAdapter } from "../store/InMemoryGraphValueStoreAdapter";
import { GraphValueStore } from "../store/GraphValueStore";
import type { GraphCachedValue } from "../store/GraphCachedValue";
import { GraphPinningService } from "../pinning/GraphPinningService";
import { GraphPinningPolicy } from "../pinning/GraphPinningPolicy";
import { GraphPinningDependencyResolver } from "../pinning/GraphPinningDependencyResolver";
import { GraphExecutionContext } from "./GraphExecutionContext";
import { GraphExecutionFrame } from "./GraphExecutionFrame";
import { buildGraphExecutionResult } from "./GraphExecutionResult";

/**
 * Configuration for the {@link GraphExecutionEngine}.
 */
export interface GraphExecutionEngineConfig {
  registry: GraphNodeExecutorRegistry;
  planner?: GraphExecutionPlanner;
  valueStoreAdapter?: GraphValueStoreAdapter;
  eventEmitter?: GraphExecutionEventEmitter;
  defaultOptions?: Partial<GraphExecutionOptions>;
  /**
   * Optional callback invoked at the end of engine construction with the
   * fully-initialised engine instance. Use this to register executors that
   * need a back-reference to the engine (e.g. loop executors that execute
   * sub-workflows through the same engine).
   */
  onEngineCreated?: (engine: GraphExecutionEngine) => void;
}

/**
 * Reference graph execution engine.
 *
 * Executes a {@link GraphWorkflowDefinition} by:
 * 1. Planning the workflow into topological layers.
 * 2. Seeding workflow inputs into the value store.
 * 3. Executing nodes layer-by-layer with configurable concurrency.
 * 4. Routing values along edges.
 * 5. Emitting structured events through Decaf's Observable pipeline.
 * 6. Returning a complete {@link GraphExecutionResult}.
 */
export class GraphExecutionEngine
  implements Observable<[GraphExecutionObserver], [GraphExecutionEvent]> {
  private readonly emitter: GraphExecutionEventEmitter;
  private readonly planner: GraphExecutionPlanner;
  private readonly valueStoreAdapter: GraphValueStoreAdapter;
  private readonly defaultOptions: Partial<GraphExecutionOptions>;

  constructor(config: GraphExecutionEngineConfig) {
    this.emitter = config.eventEmitter ?? new GraphExecutionEventEmitter();
    this.planner = config.planner ?? new GraphExecutionPlanner();
    this.valueStoreAdapter =
      config.valueStoreAdapter ?? new InMemoryGraphValueStoreAdapter();
    this.defaultOptions = config.defaultOptions ?? {};
    this.config = config;
    config.onEngineCreated?.(this);
  }

  private readonly config: GraphExecutionEngineConfig;

  observe(observer: GraphExecutionObserver): () => void {
    return this.emitter.observe(observer);
  }

  unObserve(observer: GraphExecutionObserver): void {
    this.emitter.unObserve(observer);
  }

  async updateObservers(event: GraphExecutionEvent): Promise<void> {
    await this.emitter.updateObservers(event);
  }

  /**
   * Executes a workflow with the given inputs and options.
   */
  async execute(
    workflow: GraphWorkflowDefinition,
    inputs: GraphExecutionValues = {},
    options: GraphExecutionOptions = {}
  ): Promise<GraphExecutionResult> {
    const opts = this.mergeOptions(options);
    const runId = opts.runId ?? this.generateRunId();
    const path = opts.path ?? [];
    const eventFactory = new GraphExecutionEventFactory();
    const valueStore = new GraphValueStore(this.valueStoreAdapter);
    valueStore.seedWorkflowInputs(inputs);

    const plan = this.planner.plan(workflow);
    const frame = new GraphExecutionFrame(
      runId,
      plan,
      valueStore,
      eventFactory
    );

    const emitFn = async (partial: Partial<GraphExecutionEvent>) => {
      await this.emitEvent(frame, {
        type: partial.type ?? GraphExecutionEventType.NODE_OUTPUT,
        runId,
        parentRunId: opts.parentRunId,
        workflowId: workflow.name,
        nodeId: partial.nodeId,
        path: partial.path ?? path,
        ...partial,
      });
    };

    await this.emitEvent(frame, {
      type: GraphExecutionEventType.WORKFLOW_STARTED,
      runId,
      parentRunId: opts.parentRunId,
      workflowId: workflow.name,
      path,
      status: GraphExecutionStatus.RUNNING,
      payload: { inputs },
    });

    await this.emitEvent(frame, {
      type: GraphExecutionEventType.WORKFLOW_PLANNED,
      runId,
      parentRunId: opts.parentRunId,
      workflowId: workflow.name,
      path,
      status: GraphExecutionStatus.PLANNING,
      payload: { layers: plan.layers.length, nodes: plan.nodes.length },
    });

    try {
      for (const layer of plan.layers) {
        await this.executeLayer(frame, plan, layer.nodes, opts, emitFn);
      }

      frame.finish();

      await this.emitEvent(frame, {
        type: GraphExecutionEventType.WORKFLOW_COMPLETED,
        runId,
        parentRunId: opts.parentRunId,
        workflowId: workflow.name,
        path,
        status: GraphExecutionStatus.SUCCEEDED,
        payload: { outputs: valueStore.getWorkflowValues() },
      });

      return buildGraphExecutionResult(
        frame,
        workflow,
        inputs,
        GraphExecutionStatus.SUCCEEDED,
        opts.metadata
      );
    } catch (error) {
      frame.finish();
      const errorPayload = this.toErrorPayload(error);

      await this.emitEvent(frame, {
        type: GraphExecutionEventType.WORKFLOW_FAILED,
        runId,
        parentRunId: opts.parentRunId,
        workflowId: workflow.name,
        path,
        status: GraphExecutionStatus.FAILED,
        error: errorPayload,
      });

      return buildGraphExecutionResult(
        frame,
        workflow,
        inputs,
        GraphExecutionStatus.FAILED,
        opts.metadata
      );
    }
  }

  /**
   * Pins a node and its upstream dependencies after a completed run.
   *
   * Delegates to {@link GraphPinningService}. The plan and result must come
   * from a prior successful execution of the same workflow.
   */
  async pinNode(options: GraphPinNodeOptions): Promise<void> {
    const service = this.createPinningService();
    await service.pinNode(options);
    await this.emitPinningEvent(options.nodeId, GraphExecutionEventType.NODE_PINNED);
  }

  /**
   * Unpins a node by its fingerprint.
   */
  async unpinNode(options: GraphUnpinNodeOptions): Promise<void> {
    const service = this.createPinningService();
    await service.unpinNode(options);
    await this.emitPinningEvent(options.nodeId, GraphExecutionEventType.NODE_UNPINNED);
  }

  /**
   * Creates a {@link GraphPinningService} backed by this engine's value store
   * adapter.
   */
  private createPinningService(): GraphPinningService {
    const store = new GraphValueStore(this.valueStoreAdapter);
    return new GraphPinningService(
      store,
      new GraphPinningPolicy(),
      new GraphPinningDependencyResolver()
    );
  }

  /**
   * Emits a pinning-related event to all observers.
   */
  private async emitPinningEvent(
    nodeId: string,
    type: GraphExecutionEventType
  ): Promise<void> {
    const factory = new GraphExecutionEventFactory();
    const event = factory.create({
      id: "",
      sequence: 0,
      timestamp: new Date(),
      runId: "pinning",
      workflowId: "",
      type,
      nodeId,
      path: [],
    } as Omit<GraphExecutionEvent, "id" | "sequence" | "timestamp">);
    await this.emitter.updateObservers(event);
  }

  /**
   * Executes a layer of nodes with the configured concurrency.
   */
  private async executeLayer(
    frame: GraphExecutionFrame,
    plan: GraphExecutionPlan,
    nodes: GraphExecutionPlanNode[],
    opts: GraphExecutionOptions,
    emitFn: (event: Partial<GraphExecutionEvent>) => Promise<void>
  ): Promise<void> {
    const concurrency = Math.max(
      1,
      opts.concurrency ?? GRAPH_DEFAULT_CONCURRENCY
    );
    const queue = [...nodes];

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      await Promise.all(
        batch.map((node) => this.executeNode(frame, plan, node, opts, emitFn))
      );
    }
  }

  /**
   * Executes a single node.
   */
  private async executeNode(
    frame: GraphExecutionFrame,
    plan: GraphExecutionPlan,
    planNode: GraphExecutionPlanNode,
    opts: GraphExecutionOptions,
    emitFn: (event: Partial<GraphExecutionEvent>) => Promise<void>
  ): Promise<void> {
    const startedAt = new Date();
    const nodePath = [...(opts.path ?? []), planNode.id];

    await this.emitEvent(frame, {
      type: GraphExecutionEventType.NODE_STARTED,
      runId: frame.runId,
      workflowId: plan.workflowId,
      nodeId: planNode.id,
      path: nodePath,
      status: GraphExecutionStatus.RUNNING,
    });

    const inputs = this.resolveNodeInputs(frame, plan, planNode);

    // Cache-hit: check for a pinned value before executing the node
    if (opts.usePinnedValues) {
      const cached = await this.tryPinnedValue(frame, plan, planNode, inputs);
      if (cached) {
        frame.valueStore.setNodeOutputs(planNode.id, cached.outputs);
        this.routeOutgoingEdges(frame, plan, planNode, cached.outputs);

        const finishedAt = new Date();
        const result: GraphNodeExecutionResult = {
          nodeId: planNode.id,
          status: GraphExecutionStatus.CACHED,
          inputs,
          outputs: cached.outputs,
          startedAt,
          finishedAt,
          fromCache: true,
          pinned: true,
          events: [],
        };
        frame.recordNodeResult(result);

        await this.emitEvent(frame, {
          type: GraphExecutionEventType.NODE_CACHE_HIT,
          runId: frame.runId,
          workflowId: plan.workflowId,
          nodeId: planNode.id,
          path: nodePath,
          status: GraphExecutionStatus.CACHED,
          payload: { outputs: cached.outputs },
        });

        await this.emitEvent(frame, {
          type: GraphExecutionEventType.NODE_COMPLETED,
          runId: frame.runId,
          workflowId: plan.workflowId,
          nodeId: planNode.id,
          path: nodePath,
          status: GraphExecutionStatus.SUCCEEDED,
          payload: { outputs: cached.outputs, fromCache: true },
        });
        return;
      }
    }

    try {
      const executor = this.config.registry.resolve(planNode.kind);
      const context = new GraphExecutionContext(
        frame.runId,
        opts.parentRunId,
        plan.workflow,
        planNode.definition,
        nodePath,
        emitFn,
        opts.metadata
      );

      const outputs = await executor.execute(inputs, context);
      const resolvedOutputs = outputs ?? {};

      frame.valueStore.setNodeOutputs(planNode.id, resolvedOutputs);
      this.routeOutgoingEdges(frame, plan, planNode, resolvedOutputs);

      const finishedAt = new Date();
      const result: GraphNodeExecutionResult = {
        nodeId: planNode.id,
        status: GraphExecutionStatus.SUCCEEDED,
        inputs,
        outputs: resolvedOutputs,
        startedAt,
        finishedAt,
        events: [],
      };
      frame.recordNodeResult(result);

      await this.emitEvent(frame, {
        type: GraphExecutionEventType.NODE_COMPLETED,
        runId: frame.runId,
        workflowId: plan.workflowId,
        nodeId: planNode.id,
        path: nodePath,
        status: GraphExecutionStatus.SUCCEEDED,
        payload: { outputs: resolvedOutputs },
      });
    } catch (error) {
      const finishedAt = new Date();
      const errorPayload = this.toErrorPayload(error);
      const result: GraphNodeExecutionResult = {
        nodeId: planNode.id,
        status: GraphExecutionStatus.FAILED,
        inputs,
        error: errorPayload,
        startedAt,
        finishedAt,
        events: [],
      };
      frame.recordNodeResult(result);

      await this.emitEvent(frame, {
        type: GraphExecutionEventType.NODE_FAILED,
        runId: frame.runId,
        workflowId: plan.workflowId,
        nodeId: planNode.id,
        path: nodePath,
        status: GraphExecutionStatus.FAILED,
        error: errorPayload,
      });

      if (opts.failFast ?? true) throw error;
    }
  }

  /**
   * Resolves a node's input values from incoming edges.
   */
  private resolveNodeInputs(
    frame: GraphExecutionFrame,
    plan: GraphExecutionPlan,
    planNode: GraphExecutionPlanNode
  ): GraphExecutionValues {
    const inputs: GraphExecutionValues = {};
    const incoming = plan.incomingByNode.get(planNode.id) ?? [];
    for (const edge of incoming) {
      inputs[edge.targetPort] = frame.valueStore.getPort(
        edge.sourceNodeId,
        edge.sourcePort
      );
    }
    return inputs;
  }

  /**
   * Attempts to read a pinned value for the node. Returns the cached outputs
   * when a valid pinned value exists, or `undefined` to proceed with normal
   * execution.
   */
  private async tryPinnedValue(
    frame: GraphExecutionFrame,
    plan: GraphExecutionPlan,
    planNode: GraphExecutionPlanNode,
    inputs: GraphExecutionValues
  ): Promise<GraphCachedValue | undefined> {
    const policy = new GraphPinningPolicy();
    if (!policy.shouldUsePinnedValue(planNode)) return undefined;

    const service = this.createPinningService();
    const depFingerprints = this.computeDependencyFingerprints(frame, plan, planNode.id);
    return service.readPinnedValue(
      plan.workflow,
      planNode,
      inputs,
      depFingerprints
    );
  }

  /**
   * Recursively computes fingerprints for all upstream dependencies of a node
   * using the results already accumulated in the frame.
   */
  private computeDependencyFingerprints(
    frame: GraphExecutionFrame,
    plan: GraphExecutionPlan,
    nodeId: string
  ): Record<string, string> {
    const service = this.createPinningService();
    const depResolver = new GraphPinningDependencyResolver();
    const deps = depResolver.getDependencies(plan, nodeId);
    const fingerprints: Record<string, string> = {};
    for (const dep of deps) {
      const node = plan.nodes.find((n) => n.id === dep);
      if (node) {
        const depResult = frame.nodeResults.get(dep);
        const inputs = depResult?.inputs ?? {};
        const nestedDeps = this.computeDependencyFingerprints(frame, plan, dep);
        fingerprints[dep] = service.computeFingerprint(
          plan.workflow,
          node,
          inputs,
          nestedDeps
        );
      }
    }
    return fingerprints;
  }

  /**
   * Routes a node's outputs to downstream inputs and workflow outputs.
   */
  private routeOutgoingEdges(
    frame: GraphExecutionFrame,
    plan: GraphExecutionPlan,
    planNode: GraphExecutionPlanNode,
    outputs: GraphExecutionValues
  ): void {
    const outgoing = plan.outgoingByNode.get(planNode.id) ?? [];
    for (const edge of outgoing) {
      const value = outputs[edge.sourcePort];
      if (edge.targetNodeId === GRAPH_WORKFLOW_BOUNDARY) {
        frame.valueStore.setWorkflowOutput(edge.targetPort, value);
      }
      this.emitEvent(frame, {
        type: GraphExecutionEventType.EDGE_VALUE_ROUTED,
        runId: frame.runId,
        workflowId: plan.workflowId,
        edgeId: edge.id,
        nodeId: planNode.id,
        path: [],
        payload: { edge, value },
      }).catch(() => {
        // observer failures must not crash
      });
    }
  }

  /**
   * Emits an event, records it in the frame, and dispatches to observers.
   */
  private async emitEvent(
    frame: GraphExecutionFrame,
    partial: Partial<GraphExecutionEvent> & {
      type: GraphExecutionEventType;
      runId: GraphRunId;
      workflowId: string;
      path: string[];
    }
  ): Promise<void> {
    const event = frame.eventFactory.create({
      id: "",
      sequence: 0,
      timestamp: new Date(),
      ...partial,
    } as Omit<GraphExecutionEvent, "id" | "sequence" | "timestamp">);
    frame.appendEvent(event);
    await this.emitter.updateObservers(event);
  }

  /**
   * Merges default options with the given options.
   */
  private mergeOptions(
    options: GraphExecutionOptions
  ): GraphExecutionOptions {
    return {
      concurrency: GRAPH_DEFAULT_CONCURRENCY,
      failFast: true,
      validateInputs: true,
      validateOutputs: true,
      usePinnedValues: true,
      writeThroughCache: false,
      path: [],
      metadata: {},
      ...this.defaultOptions,
      ...options,
    };
  }

  /**
   * Generates a unique run id.
   */
  private generateRunId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `graph-run-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  /**
   * Converts an error into a serialized payload.
   */
  private toErrorPayload(error: unknown): GraphExecutionErrorPayload {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code:
          (error as any).graphCode ??
          (typeof (error as any).code === "number"
            ? String((error as any).code)
            : (error as any).code),
      };
    }
    return { name: "UnknownError", message: String(error) };
  }
}
