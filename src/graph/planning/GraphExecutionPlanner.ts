/**
 * @module integrations/graph/planning/GraphExecutionPlanner
 * @summary Topological planner for graph workflows.
 * @description Resolves workflow nodes and relations, validates topology, detects cycles, and produces topological execution layers using Kahn's algorithm.
 */
import type {
  GraphNodeDefinition,
  GraphWorkflowDefinition,
} from "@decaf-ts/ui-decorators/graph";
import { graphDefinitionOf } from "@decaf-ts/ui-decorators/graph";

import { GRAPH_WORKFLOW_BOUNDARY } from "../constants";
import { GraphCycleError } from "../errors/GraphCycleError";
import { GraphTopologyError } from "../errors/GraphTopologyError";
import type { GraphExecutionPlan } from "./GraphExecutionPlan";
import type { GraphExecutionPlanNode } from "./GraphExecutionPlanNode";
import type { GraphExecutionPlanEdge } from "./GraphExecutionPlanEdge";
import type { GraphExecutionPlanLayer } from "./GraphExecutionPlanLayer";
import { GraphRelationResolver } from "./GraphRelationResolver";

/**
 * Planner that turns a {@link GraphWorkflowDefinition} into a
 * {@link GraphExecutionPlan} with topological layers.
 */
export class GraphExecutionPlanner {
  private readonly resolver: GraphRelationResolver;

  constructor(resolver?: GraphRelationResolver) {
    this.resolver = resolver ?? new GraphRelationResolver();
  }

  /**
   * Plans a workflow for execution.
   *
   * @param workflow - The workflow definition to plan.
   * @returns The execution plan with nodes, edges, layers, and maps.
   * @throws {GraphTopologyError} when node IDs are not unique.
   * @throws {GraphCycleError} when the workflow contains an unsupported cycle.
   */
  plan(workflow: GraphWorkflowDefinition): GraphExecutionPlan {
    this.validateUniqueNodeIds(workflow);

    const nodes = this.resolveNodes(workflow);
    const edges = this.resolver.resolve(workflow);

    const incomingByNode = this.buildIncomingMap(edges);
    const outgoingByNode = this.buildOutgoingMap(edges);

    const layers = this.topologicalLayers(nodes, edges);

    return {
      workflow,
      workflowId: workflow.name,
      nodes,
      edges,
      layers,
      incomingByNode,
      outgoingByNode,
    };
  }

  /**
   * Validates that all workflow node IDs are unique.
   */
  private validateUniqueNodeIds(workflow: GraphWorkflowDefinition): void {
    const seen = new Set<string>();
    for (const node of workflow.nodes ?? []) {
      if (seen.has(node.id)) {
        throw new GraphTopologyError(
          `Duplicate node id '${node.id}' in workflow '${workflow.name}'`,
          { nodeId: node.id, workflowId: workflow.name }
        );
      }
      seen.add(node.id);
    }
  }

  /**
   * Resolves workflow node metadata into plan nodes with full definitions.
   */
  private resolveNodes(
    workflow: GraphWorkflowDefinition
  ): GraphExecutionPlanNode[] {
    const result: GraphExecutionPlanNode[] = [];
    for (const nodeMeta of workflow.nodes ?? []) {
      const definition = this.resolveDefinition(nodeMeta);
      const inputPorts = (definition.ports ?? [])
        .filter((p) => p.direction === "input")
        .map((p) => p.name);
      const outputPorts = (definition.ports ?? [])
        .filter((p) => p.direction === "output")
        .map((p) => p.name);
      result.push({
        id: nodeMeta.id,
        kind: nodeMeta.kind ?? definition.kind ?? nodeMeta.id,
        label: nodeMeta.label,
        source: nodeMeta,
        definition,
        inputPorts,
        outputPorts,
        metadata: nodeMeta.metadata,
      });
    }
    return result;
  }

  /**
   * Attempts to resolve the full graph node definition from metadata.
   *
   * Accepts either a decorated Model class/instance (resolved via
   * `graphDefinitionOf`) or a plain `GraphNodeDefinition`-shaped object
   * (useful for serialized workflows that inline node definitions).
   */
  private resolveDefinition(nodeMeta: {
    node?: unknown;
    kind?: string;
    id: string;
  }): GraphNodeDefinition {
    if (nodeMeta.node) {
      if (this.isRawDefinition(nodeMeta.node)) {
        return nodeMeta.node as GraphNodeDefinition;
      }
      try {
        return graphDefinitionOf(nodeMeta.node as any);
      } catch {
        // fall through to stub
      }
    }
    // Return a minimal stub definition so planning can proceed
    return {
      name: nodeMeta.id,
      tag: nodeMeta.id,
      kind: nodeMeta.kind ?? nodeMeta.id,
      labels: [],
      ports: [],
    };
  }

  /**
   * Returns `true` when a value looks like a raw {@link GraphNodeDefinition}
   * (a plain object with a `ports` array and a `name` string).
   */
  private isRawDefinition(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { name?: unknown }).name === "string" &&
      Array.isArray((value as { ports?: unknown }).ports)
    );
  }

  /**
   * Builds a map of node id -> incoming edges.
   */
  private buildIncomingMap(
    edges: GraphExecutionPlanEdge[]
  ): Map<string, GraphExecutionPlanEdge[]> {
    const map = new Map<string, GraphExecutionPlanEdge[]>();
    for (const edge of edges) {
      const list = map.get(edge.targetNodeId) ?? [];
      list.push(edge);
      map.set(edge.targetNodeId, list);
    }
    return map;
  }

  /**
   * Builds a map of node id -> outgoing edges.
   */
  private buildOutgoingMap(
    edges: GraphExecutionPlanEdge[]
  ): Map<string, GraphExecutionPlanEdge[]> {
    const map = new Map<string, GraphExecutionPlanEdge[]>();
    for (const edge of edges) {
      const list = map.get(edge.sourceNodeId) ?? [];
      list.push(edge);
      map.set(edge.sourceNodeId, list);
    }
    return map;
  }

  /**
   * Produces topological layers using Kahn's algorithm.
   *
   * Workflow boundary edges do not count as executable-node dependencies.
   */
  private topologicalLayers(
    nodes: GraphExecutionPlanNode[],
    edges: GraphExecutionPlanEdge[]
  ): GraphExecutionPlanLayer[] {
    const executableNodes = nodes.filter(
      (n) => n.id !== GRAPH_WORKFLOW_BOUNDARY
    );
    const nodeIds = new Set(executableNodes.map((n) => n.id));

    // Only edges between two executable nodes count as dependencies
    const execEdges = edges.filter(
      (e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId)
    );

    // Compute in-degree
    const indegree = new Map<string, number>();
    for (const node of executableNodes) indegree.set(node.id, 0);
    for (const edge of execEdges) {
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    }

    const layers: GraphExecutionPlanLayer[] = [];
    const planned = new Set<string>();
    let ready = executableNodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
    let layerIndex = 0;

    while (ready.length > 0) {
      const layer: GraphExecutionPlanLayer = { index: layerIndex++, nodes: ready };
      layers.push(layer);
      const nextReady: GraphExecutionPlanNode[] = [];
      for (const node of ready) {
        planned.add(node.id);
        const outgoing = execEdges.filter((e) => e.sourceNodeId === node.id);
        for (const edge of outgoing) {
          const deg = (indegree.get(edge.targetNodeId) ?? 1) - 1;
          indegree.set(edge.targetNodeId, deg);
          if (deg === 0 && !planned.has(edge.targetNodeId)) {
            const next = executableNodes.find((n) => n.id === edge.targetNodeId);
            if (next) nextReady.push(next);
          }
        }
      }
      ready = nextReady;
    }

    if (planned.size !== executableNodes.length) {
      const unplanned = executableNodes
        .filter((n) => !planned.has(n.id))
        .map((n) => n.id);
      throw new GraphCycleError({
        unplannedNodes: unplanned,
        workflowId: nodes[0]?.definition?.name,
      });
    }

    return layers;
  }
}
