import { describe, it, expect } from "vitest";
import { mapToSections } from "./map.js";
import { extractAssumptions } from "./assumptions.js";
import { gateIntake } from "./gate.js";
import { REQUIRED_SECTIONS } from "./sections.js";
import type { ExtractedPlan } from "./types.js";

// ── Вспомогательные фикстуры ──────────────────────────────────────────────────

/** Полный план: все 22 секции с confidence=0.9 */
function fullPlan(overrides: Partial<ExtractedPlan> = {}): ExtractedPlan {
  const rawSections: Record<string, { text: string; confidence: number }> = {};
  for (const sectionId of REQUIRED_SECTIONS) {
    rawSections[sectionId] = { text: `Содержимое ${sectionId}`, confidence: 0.9 };
  }
  return {
    businessId: "biz-001",
    rawSections,
    assumptions: {
      avg_check: {
        key: "avg_check", value: { point: 500000 }, unit: "₽",
        origin: "ai_extracted" as const, confidence: 0.8, sourceSection: "pricing",
        verifiability: { verifiableBy: null, afterEvent: null }
      }
    },
    ...overrides,
  };
}

/** Частичный план — только первые N секций */
function partialPlan(n: number): ExtractedPlan {
  const rawSections: Record<string, { text: string; confidence: number }> = {};
  for (const sectionId of REQUIRED_SECTIONS.slice(0, n)) {
    rawSections[sectionId] = { text: `Содержимое ${sectionId}`, confidence: 0.85 };
  }
  return {
    businessId: "biz-partial",
    rawSections,
    assumptions: {},
  };
}

// ── ПОЗИТИВНЫЕ тесты ──────────────────────────────────────────────────────────

describe("ПОЗИТИВНЫЕ: все 22 секции присутствуют", () => {
  // §20.6: intake = A3, потолок — ask_human. "act" недостижим.
  // §20.4: disclaimer безусловный — факт-данных нет по определению.
  it("gateIntake → verdict 'ask_human' (не act), disclaimer присутствует", () => {
    const extracted = fullPlan();
    const { sections } = mapToSections(extracted);
    const result = gateIntake(sections, extracted.businessId);
    expect(result.verdict).toBe("ask_human");
    expect(result.verdict).not.toBe("act");
    expect(result.disclaimer.length).toBeGreaterThan(0);
  });

  it("extractAssumptions возвращает тот же AssumptionSet", () => {
    const extracted = fullPlan();
    const assumptions = extractAssumptions(extracted);
    expect(assumptions).toEqual(extracted.assumptions);
    expect(assumptions["avg_check"]?.value).toEqual({ point: 500000 });
  });

  it("mapToSections: sections.length = 22, все секции present=true", () => {
    const extracted = fullPlan();
    const { sections, gaps } = mapToSections(extracted);
    expect(sections).toHaveLength(22);
    expect(sections.every((s) => s.present)).toBe(true);
    expect(gaps).toHaveLength(0);
  });
});

// ── НЕГАТИВНЫЕ тесты (>= позитивных) ─────────────────────────────────────────

describe("НЕГАТИВНЫЕ: отсутствие секции 'finances'", () => {
  it("gap записан: missingSection='finances', whyMatters непустой", () => {
    const extracted = fullPlan();
    delete extracted.rawSections["finances"];
    const { gaps } = mapToSections(extracted);
    const financeGap = gaps.find((g) => g.missingSection === "finances");
    expect(financeGap).toBeDefined();
    expect(financeGap!.whyMatters.length).toBeGreaterThan(0);
  });
});

describe("НЕГАТИВНЫЕ: отсутствие секции 'team'", () => {
  it("gap записан: missingSection='team'", () => {
    const extracted = fullPlan();
    delete extracted.rawSections["team"];
    const { gaps } = mapToSections(extracted);
    const teamGap = gaps.find((g) => g.missingSection === "team");
    expect(teamGap).toBeDefined();
    expect(teamGap!.whyMatters).toContain("team");
  });
});

describe("НЕГАТИВНЫЕ: неполный план (5 из 22)", () => {
  it("gateIntake → verdict 'insufficient_data', disclaimer непустой", () => {
    const extracted = partialPlan(5);
    const { sections } = mapToSections(extracted);
    const result = gateIntake(sections, extracted.businessId);
    expect(result.verdict).toBe("insufficient_data");
    expect(result.disclaimer.length).toBeGreaterThan(0);
  });
});

describe("НЕГАТИВНЫЕ: extractAssumptions с пустым assumptions", () => {
  it("пустой AssumptionSet возвращается как пустой объект", () => {
    const extracted: ExtractedPlan = {
      businessId: "biz-empty",
      rawSections: {},
      assumptions: {},
    };
    const assumptions = extractAssumptions(extracted);
    expect(assumptions).toEqual({});
    expect(Object.keys(assumptions)).toHaveLength(0);
  });
});

describe("НЕГАТИВНЫЕ: mapToSections с пустым rawSections", () => {
  it("все 22 секции present=false", () => {
    const extracted: ExtractedPlan = {
      businessId: "biz-empty",
      rawSections: {},
      assumptions: {},
    };
    const { sections, gaps } = mapToSections(extracted);
    expect(sections).toHaveLength(22);
    expect(sections.every((s) => !s.present)).toBe(true);
    expect(gaps).toHaveLength(22);
  });
});

describe("НЕГАТИВНЫЕ: confidence среднее только по присутствующим секциям", () => {
  it("2 секции с confidence=0.95, остальные отсутствуют → среднее = 0.95, не 0.95/22", () => {
    const extracted: ExtractedPlan = {
      businessId: "biz-two",
      rawSections: {
        executive_summary: { text: "x", confidence: 0.95 },
        problem: { text: "y", confidence: 0.95 },
      },
      assumptions: {},
    };
    const { sections } = mapToSections(extracted);
    const result = gateIntake(sections, extracted.businessId);
    // 2/22 < 0.9 → insufficient_data, но confidence должен быть 0.95 (среднее по присутствующим)
    expect(result.verdict).toBe("insufficient_data");
    expect(result.confidence).toBeCloseTo(0.95);
    // убеждаемся что это НЕ 0.95/22 ≈ 0.043
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

describe("НЕГАТИВНЫЕ: отсутствует сразу несколько критических секций", () => {
  it("нет 'finances', 'team', 'risks' → все три в gaps", () => {
    const extracted = fullPlan();
    delete extracted.rawSections["finances"];
    delete extracted.rawSections["team"];
    delete extracted.rawSections["risks"];
    const { gaps } = mapToSections(extracted);
    const missing = gaps.map((g) => g.missingSection);
    expect(missing).toContain("finances");
    expect(missing).toContain("team");
    expect(missing).toContain("risks");
  });

  it("19 из 22 секций → completeness < 0.9 → gateIntake insufficient_data", () => {
    const extracted = fullPlan();
    // удаляем 4 секции → 18/22 = 0.818 < 0.9
    delete extracted.rawSections["finances"];
    delete extracted.rawSections["team"];
    delete extracted.rawSections["risks"];
    delete extracted.rawSections["legal"];
    const { sections } = mapToSections(extracted);
    const result = gateIntake(sections, extracted.businessId);
    expect(result.verdict).toBe("insufficient_data");
    expect(result.disclaimer).toBeTruthy();
  });
});

describe("НЕГАТИВНЫЕ: REQUIRED_SECTIONS содержит ровно 22 элемента", () => {
  it("REQUIRED_SECTIONS.length === 22", () => {
    expect(REQUIRED_SECTIONS.length).toBe(22);
  });
});
