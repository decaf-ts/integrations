/**
 * @module integrations/graph/planning/GraphRelationResolver
 * @summary Normalizes workflow relations into execution edges.
 * @description Resolves workflow boundary aliases, validates endpoints and ports, and produces stable edge IDs.
 */
import type {
  GraphPortDefinition,
  GraphWorkflowDefinition,
  GraphWorkflowRelationMetadata,
} from "@decaf-ts/ui-decorators/graph";
import { graphDefinitionOf } from "@decaf-ts/ui-decorators/graph";

import { GRAPH_WORKFLOW_BOUNDARY } from "../constants";
import { GraphPortError } from "../errors/GraphPortError";
import { GraphTopologyError } from "../errors/GraphTopologyError";
import type { GraphExecutionPlanEdge } from "./GraphExecutionPlanEdge";

/**
 * Resolves raw workflow relation metadata into normalized execution edges.
 */
export class GraphRelationResolver {
  /**
   * Resolves all relations of a workflow into execution edges.
   *
   * @param workflow - The workflow definition.
   * @returns Array of normalized edges.
   * @throws {GraphTopologyError} when an endpoint is unknown or ambiguous.
   * @throws {GraphPortError} when a referenced port is missing or unknown.
   */
  resolve(workflow: GraphWorkflowDefinition): GraphExecutionPlanEdge[] {
    const nodeIds = new Set(workflow.nodes.map((n) => n.id));
    const boundaryAliases = this.boundaryAliases(workflow);
    const inputPorts = this.portNames(workflow.inputs);
    const outputPorts = this.portNames(workflow.outputs);
    const nodePortMap = this.buildNodePortMap(workflow);

    const edges: GraphExecutionPlanEdge[] = [];

    for (const relation of workflow.relations ?? []) {
      const edge = this.resolveRelation(
        relation,
        nodeIds,
        boundaryAliases,
        inputPorts,
        outputPorts,
        nodePortMap
      );
      edges.push(edge);
    }

    return edges;
  }

  /**
   * Resolves a single relation into an edge.
   */
  private resolveRelation(
    relation: GraphWorkflowRelationMetadata,
    nodeIds: Set<string>,
    boundaryAliases: Set<string>,
    inputPorts: Set<string>,
    outputPorts: Set<string>,
    nodePortMap: Map<string, { input: Set<string>; output: Set<string> }>
  ): GraphExecutionPlanEdge {
    const sourceNodeId = this.resolveEndpoint(
      relation.source,
      nodeIds,
      boundaryAliases
    );
    const targetNodeId = this.resolveEndpoint(
      relation.target,
      nodeIds,
      boundaryAliases
    );

    const sourcePort = relation.sourcePort;
    const targetPort = relation.targetPort;

    if (!sourcePort) {
      throw new GraphPortError(
        `Relation is missing sourcePort (source: ${String(relation.source)}, target: ${String(relation.target)})`,
        { relation }
      );
    }
    if (!targetPort) {
      throw new GraphPortError(
        `Relation is missing targetPort (source: ${String(relation.source)}, target: ${String(relation.target)})`,
        { relation }
      );
    }

    this.validatePort(
      sourceNodeId,
      sourcePort,
      true,
      boundaryAliases,
      inputPorts,
      outputPorts,
      nodePortMap
    );
    this.validatePort(
      targetNodeId,
      targetPort,
      false,
      boundaryAliases,
      inputPorts,
      outputPorts,
      nodePortMap
    );

    return {
      id: this.createEdgeId(sourceNodeId, sourcePort, targetNodeId, targetPort),
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort,
      label: relation.label,
      metadata: relation.metadata,
    };
  }

  /**
   * Resolves an endpoint (source or target) to a node id or the workflow boundary.
   */
  private resolveEndpoint(
    endpoint: string | unknown,
    nodeIds: Set<string>,
    boundaryAliases: Set<string>
  ): string {
    const name = String(endpoint);
    if (boundaryAliases.has(name)) return GRAPH_WORKFLOW_BOUNDARY;
    if (nodeIds.has(name)) return name;
    throw new GraphTopologyError(
      `Unknown endpoint '${name}'`,
      { endpoint: name, knownNodes: Array.from(nodeIds) }
    );
  }

  /**
   * Validates that a port exists on the given node or boundary.
   */
  private validatePort(
    nodeId: string,
    port: string,
    isSource: boolean,
    boundaryAliases: Set<string>,
    inputPorts: Set<string>,
    outputPorts: Set<string>,
    nodePortMap: Map<string, { input: Set<string>; output: Set<string> }>
  ): void {
    if (nodeId === GRAPH_WORKFLOW_BOUNDARY) {
      const ports = isSource ? inputPorts : outputPorts;
      if (!ports.has(port)) {
        throw new GraphPortError(
          `Unknown ${isSource ? "input" : "output"} port '${port}' on workflow boundary`,
          { nodeId, port, isSource, available: Array.from(ports) }
        );
      }
      return;
    }

    const nodePorts = nodePortMap.get(nodeId);
    if (!nodePorts) {
      throw new GraphTopologyError(`No port map for node '${nodeId}'`, {
        nodeId,
      });
    }

    const ports = isSource ? nodePorts.output : nodePorts.input;
    if (!ports.has(port)) {
      throw new GraphPortError(
        `Unknown ${isSource ? "output" : "input"} port '${port}' on node '${nodeId}'`,
        { nodeId, port, isSource, available: Array.from(ports) }
      );
    }
  }

  /**
   * Builds the set of boundary aliases for a workflow.
   */
  private boundaryAliases(workflow: GraphWorkflowDefinition): Set<string> {
    return new Set([
      GRAPH_WORKFLOW_BOUNDARY,
      "workflow",
      "graph",
      workflow.name,
    ]);
  }

  /**
   * Extracts port names from a list of port definitions.
   */
  private portNames(ports: GraphPortDefinition[] | undefined): Set<string> {
    return new Set((ports ?? []).map((p) => p.name));
  }

  /**
   * Builds a map of node id -> { input ports, output ports }.
   */
  private buildNodePortMap(
    workflow: GraphWorkflowDefinition
  ): Map<string, { input: Set<string>; output: Set<string> }> {
    const map = new Map<string, { input: Set<string>; output: Set<string> }>();
    for (const nodeMeta of workflow.nodes ?? []) {
      const input = new Set<string>();
      const output = new Set<string>();
      const def = this.resolveNodeDefinition(nodeMeta);
      if (def) {
        for (const port of def.ports ?? []) {
          if (port.direction === "input") input.add(port.name);
          else output.add(port.name);
        }
      }
      map.set(nodeMeta.id, { input, output });
    }
    return map;
  }

  /**
   * Attempts to resolve a node's full definition from its metadata.
   *
   * Accepts either a decorated Model class/instance (resolved via
   * `graphDefinitionOf`) or a plain `GraphNodeDefinition`-shaped object
   * (useful for serialized workflows that inline node definitions).
   */
  private resolveNodeDefinition(
    nodeMeta: { node?: unknown; kind?: string }
  ): { ports: { direction: string; name: string }[] } | undefined {
    if (nodeMeta.node) {
      if (this.isRawDefinition(nodeMeta.node)) {
        return nodeMeta.node as {
          ports: { direction: string; name: string }[];
        };
      }
      try {
        const def = graphDefinitionOf(nodeMeta.node as any);
        return def as any;
      } catch {
        return undefined;
      }
    }
    return undefined;
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
   * Creates a stable edge id from its endpoints and ports.
   */
  private createEdgeId(
    sourceNodeId: string,
    sourcePort: string,
    targetNodeId: string,
    targetPort: string
  ): string {
    return `${sourceNodeId}:${sourcePort}->${targetNodeId}:${targetPort}`;
  }
}
