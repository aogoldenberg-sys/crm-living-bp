import type { CausalGraph, CausalNode, CausalEdge, EdgeDirection } from "@crm/schemas";
import type { SwotItem } from "../lenses/types.js";

// ── buildGraph ────────────────────────────────────────────────────────────────

/**
 * Build a CausalGraph from a template, optionally attaching section references.
 * sectionMap: nodeId → section_ref string (e.g. { revenue: "finance.revenue" })
 */
export function buildGraph(
  template: CausalGraph,
  sectionMap?: Record<string, string>,
): CausalGraph {
  // Deep-clone via JSON (all values are JSON-serialisable primitives)
  const graph: CausalGraph = JSON.parse(JSON.stringify(template)) as CausalGraph;

  if (sectionMap) {
    for (const node of graph.nodes) {
      if (sectionMap[node.id] !== undefined) {
        node.section_ref = sectionMap[node.id];
      }
    }
  }

  return graph;
}

// ── propagate ─────────────────────────────────────────────────────────────────

export interface PropagateResult {
  /** All nodes affected by the change (excluding the source) */
  affected: CausalNode[];
  /** Chain of edges traversed */
  chain: Array<{
    fromId: string;
    toId: string;
    direction: EdgeDirection;
    strength: number;
    cumulativeEffect: number;
  }>;
}

/**
 * Propagate the effect of a changed node through the graph.
 * Follows directed edges. Confidence gate:
 *   - Edges with origin="ai_hypothesis" AND strength < 0.3 are SKIPPED.
 * cumulativeEffect = product of direction*strength along the path.
 * Stops at cycles (visited set).
 */
export function propagate(
  graph: CausalGraph,
  changedNodeId: string,
): PropagateResult {
  const nodeMap = new Map<string, CausalNode>(
    graph.nodes.map((n) => [n.id, n]),
  );

  // Build adjacency list: from → edges
  const adj = new Map<string, CausalEdge[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge);
  }

  const affected: CausalNode[] = [];
  const chain: PropagateResult["chain"] = [];
  const visited = new Set<string>([changedNodeId]);

  // BFS queue: [nodeId, cumulativeEffect]
  const queue: Array<{ nodeId: string; cumEffect: number }> = [
    { nodeId: changedNodeId, cumEffect: 1.0 },
  ];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const edges = adj.get(item.nodeId) ?? [];

    for (const edge of edges) {
      // Confidence gate
      if (edge.origin === "ai_hypothesis" && edge.strength < 0.3) continue;

      const toId = edge.to;
      const newCumEffect = item.cumEffect * edge.direction * edge.strength;

      chain.push({
        fromId: item.nodeId,
        toId,
        direction: edge.direction,
        strength: edge.strength,
        cumulativeEffect: newCumEffect,
      });

      if (!visited.has(toId)) {
        visited.add(toId);
        const toNode = nodeMap.get(toId);
        if (toNode) {
          affected.push(toNode);
          queue.push({ nodeId: toId, cumEffect: newCumEffect });
        }
      }
    }
  }

  return { affected, chain };
}

// ── calibrate ─────────────────────────────────────────────────────────────────

/**
 * Calibrate edge strengths based on observed events.
 * Deterministic, NO Claude.
 */
export function calibrate(
  graph: CausalGraph,
  eventIds: string[],
): CausalGraph {
  const eventSet = new Set(eventIds);

  const newEdges: CausalEdge[] = graph.edges.map((edge) => {
    const evidenceCount = edge.evidence.filter((id) => eventSet.has(id)).length;

    // Already confirmed — never downgrade
    if (edge.origin === "confirmed") {
      if (evidenceCount > 0) {
        return {
          ...edge,
          strength: Math.min(1, edge.strength + evidenceCount * 0.1),
        };
      }
      return edge;
    }

    if (evidenceCount >= 3) {
      return {
        ...edge,
        origin: "confirmed" as const,
        strength: Math.min(1, edge.strength + evidenceCount * 0.1),
      };
    }

    if (evidenceCount === 0 && edge.origin === "template") {
      return {
        ...edge,
        origin: "ai_hypothesis" as const,
      };
    }

    // 0 < evidenceCount < 3: minor boost, keep origin
    return {
      ...edge,
      strength: Math.min(1, edge.strength + evidenceCount * 0.05),
    };
  });

  return { nodes: graph.nodes, edges: newEdges };
}

// ── deriveSWOT ────────────────────────────────────────────────────────────────

export interface DerivedSWOT {
  strengths: SwotItem[];
  opportunities: SwotItem[];
  threats: SwotItem[];
  weaknesses: SwotItem[];
}

/**
 * Derive SWOT items from a CausalGraph.
 *
 * Threats:       external nodes with confirmed/strong (strength >= 0.5) negative (-1)
 *                edges pointing TO an outcome node.
 * Strengths:     process/metric nodes with confirmed positive (+1) edges to outcomes.
 * Opportunities: external nodes with positive (+1) edges to outcome nodes
 *                (not yet confirmed — origin = "template" or "ai_hypothesis").
 * Weaknesses:    process nodes with negative (-1) edges from them to outcome.
 *
 * Confidence gate: only edges with strength >= 0.3 are included.
 */
export function deriveSWOT(graph: CausalGraph): DerivedSWOT {
  const nodeMap = new Map<string, CausalNode>(
    graph.nodes.map((n) => [n.id, n]),
  );

  const strengths: SwotItem[] = [];
  const opportunities: SwotItem[] = [];
  const threats: SwotItem[] = [];
  const weaknesses: SwotItem[] = [];

  for (const edge of graph.edges) {
    // Confidence gate
    if (edge.strength < 0.3) continue;

    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (toNode.type !== "outcome") continue;

    // Threats: external → outcome, direction=-1, strength>=0.5, confirmed/strong
    if (
      fromNode.type === "external" &&
      edge.direction === -1 &&
      edge.strength >= 0.5
    ) {
      threats.push({
        signal: `Угроза: ${fromNode.label} → ${toNode.label}`,
        detail: `Внешний фактор негативно влияет на ${toNode.label} (сила ${edge.strength.toFixed(2)})`,
        source: edge.from,
      });
    }

    // Strengths: process/metric → outcome, direction=+1, confirmed
    if (
      (fromNode.type === "process" || fromNode.type === "metric") &&
      edge.direction === 1 &&
      edge.origin === "confirmed"
    ) {
      strengths.push({
        signal: `Сила: ${fromNode.label} → ${toNode.label}`,
        detail: `Подтверждённое положительное влияние на ${toNode.label} (сила ${edge.strength.toFixed(2)})`,
        source: edge.from,
      });
    }

    // Opportunities: external → outcome, direction=+1, NOT confirmed
    if (
      fromNode.type === "external" &&
      edge.direction === 1 &&
      edge.origin !== "confirmed"
    ) {
      opportunities.push({
        signal: `Возможность: ${fromNode.label} → ${toNode.label}`,
        detail: `Внешний фактор может положительно повлиять на ${toNode.label} (сила ${edge.strength.toFixed(2)})`,
        source: edge.from,
      });
    }

    // Weaknesses: process → outcome, direction=-1
    if (fromNode.type === "process" && edge.direction === -1) {
      weaknesses.push({
        signal: `Слабость: ${fromNode.label} → ${toNode.label}`,
        detail: `Процессный фактор негативно влияет на ${toNode.label} (сила ${edge.strength.toFixed(2)})`,
        source: edge.from,
      });
    }
  }

  return { strengths, opportunities, threats, weaknesses };
}
