import { describe, it, expect } from "vitest";
import { computeSwotStructure } from "./swot.js";

// ── Strengths ─────────────────────────────────────────────────────────────────

describe("computeSwotStructure — strengths populated", () => {
  const result = computeSwotStructure({
    marginPercent: 0.30,
    ltvCacRatio: 4,
    revenueGrowthRate: 0.15,
  });

  it("returns non-null result", () => {
    expect(result).not.toBeNull();
  });

  it("strength: Маржа выше порога (marginPercent > 0.20)", () => {
    const found = result!.strengths.some((s) => s.source === "marginPercent");
    expect(found).toBe(true);
  });

  it("strength: LTV/CAC > 3x (ltvCacRatio > 3)", () => {
    const found = result!.strengths.some((s) => s.source === "ltvCacRatio");
    expect(found).toBe(true);
  });

  it("strength: Рост выручки (revenueGrowthRate > 0.10)", () => {
    const found = result!.strengths.some((s) => s.source === "revenueGrowthRate");
    expect(found).toBe(true);
  });

  it("no weaknesses when all metrics are healthy", () => {
    expect(result!.weaknesses).toHaveLength(0);
  });

  it("opportunities is always empty array (stub)", () => {
    expect(result!.opportunities).toEqual([]);
  });

  it("threats is always empty array (stub)", () => {
    expect(result!.threats).toEqual([]);
  });
});

// ── Weaknesses ───────────────────────────────────────────────────────────────

describe("computeSwotStructure — weaknesses populated", () => {
  const result = computeSwotStructure({
    marginPercent: 0.02,
    topClientConcentration: 0.70,
    dealVelocityDays: 120,
    paybackMonths: 30,
  });

  it("returns non-null result", () => {
    expect(result).not.toBeNull();
  });

  it("weakness: Низкая маржа (marginPercent < 0.05)", () => {
    const found = result!.weaknesses.some((s) => s.source === "marginPercent");
    expect(found).toBe(true);
  });

  it("weakness: Высокая концентрация (topClientConcentration > 0.60)", () => {
    const found = result!.weaknesses.some((s) => s.source === "topClientConcentration");
    expect(found).toBe(true);
  });

  it("weakness: Долгий цикл сделки (dealVelocityDays > 90)", () => {
    const found = result!.weaknesses.some((s) => s.source === "dealVelocityDays");
    expect(found).toBe(true);
  });

  it("weakness: Долгий payback (paybackMonths > 24)", () => {
    const found = result!.weaknesses.some((s) => s.source === "paybackMonths");
    expect(found).toBe(true);
  });

  it("no strengths when all metrics are poor", () => {
    expect(result!.strengths).toHaveLength(0);
  });
});

// ── Boundary: exactly at threshold ───────────────────────────────────────────

describe("computeSwotStructure — exact threshold values", () => {
  it("marginPercent exactly at 0.20 does NOT trigger strength (> not >=)", () => {
    const result = computeSwotStructure({ marginPercent: 0.20 });
    expect(result!.strengths.some((s) => s.source === "marginPercent")).toBe(false);
  });

  it("marginPercent exactly at 0.05 does NOT trigger weakness (< not <=)", () => {
    const result = computeSwotStructure({ marginPercent: 0.05 });
    expect(result!.weaknesses.some((s) => s.source === "marginPercent")).toBe(false);
  });

  it("ltvCacRatio exactly at 3 does NOT trigger strength (> not >=)", () => {
    const result = computeSwotStructure({ ltvCacRatio: 3 });
    expect(result!.strengths.some((s) => s.source === "ltvCacRatio")).toBe(false);
  });
});

// ── Confidence gate: all undefined → null ────────────────────────────────────

describe("computeSwotStructure — all undefined → null", () => {
  it("returns null when no fields provided", () => {
    const result = computeSwotStructure({});
    expect(result).toBeNull();
  });

  it("returns null when no fields provided (empty object)", () => {
    // exactOptionalPropertyTypes: don't pass undefined values explicitly
    const input: Parameters<typeof computeSwotStructure>[0] = {};
    const result = computeSwotStructure(input);
    expect(result).toBeNull();
  });

  it("returns null when paybackMonths is null and others undefined", () => {
    const result = computeSwotStructure({
      paybackMonths: null,
    });
    expect(result).toBeNull();
  });
});

// ── Single metric provided ────────────────────────────────────────────────────

describe("computeSwotStructure — single metric", () => {
  it("returns non-null when only marginPercent provided", () => {
    const result = computeSwotStructure({ marginPercent: 0.30 });
    expect(result).not.toBeNull();
  });

  it("returns non-null when only revenueGrowthRate provided", () => {
    const result = computeSwotStructure({ revenueGrowthRate: 0.20 });
    expect(result).not.toBeNull();
  });
});
