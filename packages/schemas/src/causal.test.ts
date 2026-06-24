import { describe, it, expect } from "vitest";
import { CausalNode, CausalEdge, CausalGraph } from "./causal.js";

describe("CausalNode schema", () => {
  it("parses a valid node", () => {
    const node = CausalNode.parse({
      id: "revenue",
      label: "Выручка",
      type: "outcome",
      section_ref: "finance.revenue",
      current_value: 1000000,
      trend: "up",
    });
    expect(node.id).toBe("revenue");
    expect(node.type).toBe("outcome");
  });

  it("parses a minimal node (no optional fields)", () => {
    const node = CausalNode.parse({
      id: "ad_spend",
      label: "Рекламные расходы",
      type: "external",
    });
    expect(node.section_ref).toBeUndefined();
    expect(node.trend).toBeUndefined();
  });
});

describe("CausalEdge schema", () => {
  it("parses a valid edge with direction=1", () => {
    const edge = CausalEdge.parse({
      from: "ad_spend",
      to: "lead_count",
      direction: 1,
      strength: 0.7,
      lag_days: 3,
      evidence: [],
      origin: "template",
    });
    expect(edge.direction).toBe(1);
  });

  it("parses a valid edge with direction=-1", () => {
    const edge = CausalEdge.parse({
      from: "ad_spend",
      to: "margin",
      direction: -1,
      strength: 0.6,
      lag_days: 0,
      evidence: ["evt1", "evt2"],
      origin: "confirmed",
    });
    expect(edge.direction).toBe(-1);
  });

  it("throws when direction=2 (invalid)", () => {
    expect(() =>
      CausalEdge.parse({
        from: "a",
        to: "b",
        direction: 2,
        strength: 0.5,
        lag_days: 0,
        evidence: [],
        origin: "template",
      })
    ).toThrow();
  });

  it("throws when strength > 1", () => {
    expect(() =>
      CausalEdge.parse({
        from: "a",
        to: "b",
        direction: 1,
        strength: 1.5,
        lag_days: 0,
        evidence: [],
        origin: "template",
      })
    ).toThrow();
  });
});

describe("CausalGraph schema", () => {
  it("parses a valid graph", () => {
    const graph = CausalGraph.parse({
      nodes: [
        { id: "ad_spend", label: "Рекламные расходы", type: "external" },
        { id: "revenue",  label: "Выручка",           type: "outcome" },
      ],
      edges: [
        {
          from: "ad_spend",
          to: "revenue",
          direction: 1,
          strength: 0.8,
          lag_days: 14,
          evidence: [],
          origin: "template",
        },
      ],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it("parses an empty graph", () => {
    const graph = CausalGraph.parse({ nodes: [], edges: [] });
    expect(graph.nodes).toHaveLength(0);
  });
});
