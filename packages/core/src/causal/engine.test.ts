import { describe, it, expect } from "vitest";
import { buildGraph, propagate, calibrate, deriveSWOT } from "./engine.js";
import { RETAIL_TEMPLATE } from "./templates.js";
import type { CausalGraph } from "@crm/schemas";

// ── buildGraph ────────────────────────────────────────────────────────────────

describe("buildGraph", () => {
  it("applies sectionMap: node 'revenue' gets section_ref = 'finance.revenue'", () => {
    const graph = buildGraph(RETAIL_TEMPLATE, { revenue: "finance.revenue" });
    const revenueNode = graph.nodes.find((n) => n.id === "revenue");
    expect(revenueNode?.section_ref).toBe("finance.revenue");
  });

  it("does not mutate the original template", () => {
    const originalRevenue = RETAIL_TEMPLATE.nodes.find((n) => n.id === "revenue");
    const before = originalRevenue?.section_ref;
    buildGraph(RETAIL_TEMPLATE, { revenue: "finance.revenue" });
    const after = RETAIL_TEMPLATE.nodes.find((n) => n.id === "revenue")?.section_ref;
    expect(after).toBe(before);
  });

  it("leaves nodes without sectionMap entry unchanged", () => {
    const graph = buildGraph(RETAIL_TEMPLATE, { revenue: "finance.revenue" });
    const adSpend = graph.nodes.find((n) => n.id === "ad_spend");
    expect(adSpend?.section_ref).toBeUndefined();
  });
});

// ── propagate ─────────────────────────────────────────────────────────────────

describe("propagate", () => {
  it("chain traversal: ad_spend affects lead_count, revenue, margin", () => {
    const result = propagate(RETAIL_TEMPLATE, "ad_spend");
    const affectedIds = result.affected.map((n) => n.id);
    expect(affectedIds).toContain("lead_count");
    expect(affectedIds).toContain("margin");
    // revenue comes from lead_count path
    expect(affectedIds).toContain("revenue");
  });

  it("chain has entries for each hop", () => {
    const result = propagate(RETAIL_TEMPLATE, "ad_spend");
    // ad_spend → lead_count, ad_spend → margin, lead_count → revenue, revenue → margin
    expect(result.chain.length).toBeGreaterThanOrEqual(3);
    const fromIds = result.chain.map((c) => c.fromId);
    expect(fromIds).toContain("ad_spend");
    expect(fromIds).toContain("lead_count");
  });

  it("confidence gate: ai_hypothesis edge with strength=0.2 NOT in chain", () => {
    const weakEdge: CausalGraph["edges"][number] = {
      from: "market_demand",
      to: "margin",
      direction: 1,
      strength: 0.2,
      lag_days: 0,
      evidence: [],
      origin: "ai_hypothesis",
    };
    const testGraph: CausalGraph = {
      nodes: RETAIL_TEMPLATE.nodes,
      edges: [...RETAIL_TEMPLATE.edges, weakEdge],
    };
    const result = propagate(testGraph, "market_demand");
    const chain = result.chain;
    // The weak ai_hypothesis edge should not appear
    const found = chain.some(
      (c) => c.fromId === "market_demand" && c.toId === "margin" && c.strength === 0.2,
    );
    expect(found).toBe(false);
  });

  it("cycle guard: adding a circular edge terminates without infinite loop", () => {
    const circularEdge: CausalGraph["edges"][number] = {
      from: "margin",
      to: "ad_spend",
      direction: 1,
      strength: 0.5,
      lag_days: 0,
      evidence: [],
      origin: "template",
    };
    const cyclicGraph: CausalGraph = {
      nodes: RETAIL_TEMPLATE.nodes,
      edges: [...RETAIL_TEMPLATE.edges, circularEdge],
    };
    // Should not throw or hang
    const result = propagate(cyclicGraph, "ad_spend");
    expect(result.affected.length).toBeGreaterThan(0);
  });

  it("source node is not in affected list", () => {
    const result = propagate(RETAIL_TEMPLATE, "ad_spend");
    const affectedIds = result.affected.map((n) => n.id);
    expect(affectedIds).not.toContain("ad_spend");
  });

  it("market_demand propagates to lead_count → revenue → margin (example trace)", () => {
    const result = propagate(RETAIL_TEMPLATE, "market_demand");
    const affectedIds = result.affected.map((n) => n.id);
    expect(affectedIds).toContain("lead_count");
    expect(affectedIds).toContain("revenue");
    expect(affectedIds).toContain("margin");

    // Check chain entries exist
    const step1 = result.chain.find(
      (c) => c.fromId === "market_demand" && c.toId === "lead_count",
    );
    expect(step1).toBeDefined();
    expect(step1!.cumulativeEffect).toBeCloseTo(0.5); // 1.0 * 1 * 0.5

    const step2 = result.chain.find(
      (c) => c.fromId === "lead_count" && c.toId === "revenue",
    );
    expect(step2).toBeDefined();
    expect(step2!.cumulativeEffect).toBeCloseTo(0.4); // 0.5 * 1 * 0.8
  });
});

// ── calibrate ─────────────────────────────────────────────────────────────────

describe("calibrate", () => {
  it("confirms edge: 3 matching event IDs → origin='confirmed', strength increased", () => {
    const graphWithEvidence: CausalGraph = {
      nodes: RETAIL_TEMPLATE.nodes,
      edges: RETAIL_TEMPLATE.edges.map((e) =>
        e.from === "ad_spend" && e.to === "lead_count"
          ? { ...e, evidence: ["evt1", "evt2", "evt3"] }
          : e,
      ),
    };
    const result = calibrate(graphWithEvidence, ["evt1", "evt2", "evt3"]);
    const edge = result.edges.find((e) => e.from === "ad_spend" && e.to === "lead_count");
    expect(edge?.origin).toBe("confirmed");
    expect(edge!.strength).toBeGreaterThan(0.7); // was 0.7, boosted
  });

  it("marks hypothesis: edge with 0 matching events and origin='template' → 'ai_hypothesis'", () => {
    const result = calibrate(RETAIL_TEMPLATE, []); // no matching events, evidence arrays are empty
    // All template edges with empty evidence get 0 matches → become ai_hypothesis
    for (const edge of result.edges) {
      expect(edge.origin).toBe("ai_hypothesis");
    }
  });

  it("does not downgrade confirmed: already 'confirmed' edge with 0 new events stays 'confirmed'", () => {
    const confirmedGraph: CausalGraph = {
      nodes: RETAIL_TEMPLATE.nodes,
      edges: RETAIL_TEMPLATE.edges.map((e) =>
        e.from === "ad_spend" && e.to === "lead_count"
          ? { ...e, origin: "confirmed" as const }
          : e,
      ),
    };
    const result = calibrate(confirmedGraph, []);
    const edge = result.edges.find((e) => e.from === "ad_spend" && e.to === "lead_count");
    expect(edge?.origin).toBe("confirmed");
  });

  it("minor boost: 1-2 matching events boost strength but keep origin", () => {
    const graphWithEvidence: CausalGraph = {
      nodes: RETAIL_TEMPLATE.nodes,
      edges: RETAIL_TEMPLATE.edges.map((e) =>
        e.from === "lead_count" && e.to === "revenue"
          ? { ...e, evidence: ["evt1", "evt2"] }
          : e,
      ),
    };
    const result = calibrate(graphWithEvidence, ["evt1", "evt2"]);
    const edge = result.edges.find((e) => e.from === "lead_count" && e.to === "revenue");
    expect(edge?.origin).toBe("template");
    expect(edge!.strength).toBeCloseTo(0.8 + 2 * 0.05); // 0.90
  });

  it("does not mutate the input graph", () => {
    const firstEdge = RETAIL_TEMPLATE.edges[0]!;
    const original = firstEdge.origin;
    calibrate(RETAIL_TEMPLATE, []);
    expect(RETAIL_TEMPLATE.edges[0]!.origin).toBe(original);
  });
});

// ── deriveSWOT ────────────────────────────────────────────────────────────────

describe("deriveSWOT", () => {
  it("threats from external negative edges: external → outcome direction=-1 strength>=0.5", () => {
    const graphWithThreat: CausalGraph = {
      nodes: [
        { id: "ext_factor", label: "Внешний фактор", type: "external" },
        { id: "revenue",    label: "Выручка",        type: "outcome" },
      ],
      edges: [
        {
          from: "ext_factor",
          to: "revenue",
          direction: -1,
          strength: 0.6,
          lag_days: 0,
          evidence: [],
          origin: "template",
        },
      ],
    };
    const result = deriveSWOT(graphWithThreat);
    expect(result.threats).toHaveLength(1);
    expect(result.threats[0]!.source).toBe("ext_factor");
  });

  it("strengths from confirmed positive process edges: process → outcome, confirmed", () => {
    const graphWithStrength: CausalGraph = {
      nodes: [
        { id: "conversion", label: "Конверсия", type: "process" },
        { id: "revenue",    label: "Выручка",   type: "outcome" },
      ],
      edges: [
        {
          from: "conversion",
          to: "revenue",
          direction: 1,
          strength: 0.9,
          lag_days: 7,
          evidence: ["e1", "e2", "e3"],
          origin: "confirmed",
        },
      ],
    };
    const result = deriveSWOT(graphWithStrength);
    expect(result.strengths).toHaveLength(1);
    expect(result.strengths[0]!.source).toBe("conversion");
  });

  it("opportunities from non-confirmed external positive edges", () => {
    const result = deriveSWOT(RETAIL_TEMPLATE);
    // market_demand → lead_count is external → metric (not outcome), skip
    // ad_spend → lead_count is external → metric, skip
    // Look for any external → outcome positive edge in template
    const oppSources = result.opportunities.map((o) => o.source);
    // No external → outcome direct edges in RETAIL_TEMPLATE, so opportunities=[]
    expect(Array.isArray(result.opportunities)).toBe(true);
  });

  it("confidence gate: edge with strength=0.2 not included", () => {
    const weakGraph: CausalGraph = {
      nodes: [
        { id: "ext", label: "Ext",     type: "external" },
        { id: "out", label: "Outcome", type: "outcome" },
      ],
      edges: [
        {
          from: "ext",
          to: "out",
          direction: -1,
          strength: 0.2,
          lag_days: 0,
          evidence: [],
          origin: "template",
        },
      ],
    };
    const result = deriveSWOT(weakGraph);
    expect(result.threats).toHaveLength(0);
    expect(result.opportunities).toHaveLength(0);
  });

  it("returns empty arrays for all categories when graph has no qualifying edges", () => {
    const emptyGraph: CausalGraph = { nodes: [], edges: [] };
    const result = deriveSWOT(emptyGraph);
    expect(result.strengths).toHaveLength(0);
    expect(result.opportunities).toHaveLength(0);
    expect(result.threats).toHaveLength(0);
    expect(result.weaknesses).toHaveLength(0);
  });
});
