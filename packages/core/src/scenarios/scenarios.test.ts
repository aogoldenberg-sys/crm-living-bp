import { describe, it, expect } from "vitest";
import { mulberry32 } from "../forecast/prng.js";
import { simulateScenario } from "./simulate.js";
import { rankScenarios } from "./rank.js";
import { buildPlanDiff } from "./diff.js";
import type { BusinessPlanV1, StrategyLever } from "@crm/schemas";
import type { CashForecast } from "../forecast/types.js";

const PLAN: BusinessPlanV1 = {
  planId: "550e8400-e29b-41d4-a716-446655440000",
  businessId: "biz-1",
  version: 1,
  status: "active",
  parentVersion: null,
  sourceIntakeId: "660e8400-e29b-41d4-a716-446655440001",
  createdAt: "2026-07-01T00:00:00Z",
  assumptions: {
    avg_deal_amount: { key: "avg_deal_amount", value: { point: 100_000_00 }, unit: "копейки", origin: "ai_extracted", confidence: 0.8, sourceSection: null, verifiability: { verifiableBy: null, afterEvent: null } },
    fixed_daily_outflow: { key: "fixed_daily_outflow", value: { point: 50_000_00 }, unit: "копейки", origin: "ai_extracted", confidence: 0.8, sourceSection: null, verifiability: { verifiableBy: null, afterEvent: null } },
    expected_daily_deals: { key: "expected_daily_deals", value: { point: 2 }, unit: "сделок", origin: "ai_extracted", confidence: 0.8, sourceSection: null, verifiability: { verifiableBy: null, afterEvent: null } },
  },
};

const BASE_FORECAST: CashForecast = {
  generatedAt: "2026-07-01",
  horizonDays: 90,
  dailyBalances: [],
  gapDate: "2026-08-15",
  gapAmount: -500_000,
  hardGapDate: null,
  pessimisticGapDate: "2026-08-10",
  confidence: 0.3,
};

const LEVERS_LOW: StrategyLever[] = [
  { id: "scale", label: "Масштабирование объёмов", description: "Увеличить объём", causal_node_ids: ["revenue"] },
];

const LEVERS_MED: StrategyLever[] = [
  { id: "scale", label: "Масштабирование объёмов", description: "Увеличить объём", causal_node_ids: ["revenue"] },
  { id: "process_automation", label: "Автоматизация", description: "Снизить затраты", causal_node_ids: ["margin"] },
];

const LEVERS_HIGH: StrategyLever[] = [
  { id: "scale", label: "Масштабирование объёмов", description: "Увеличить объём", causal_node_ids: ["revenue"] },
  { id: "process_automation", label: "Автоматизация", description: "Снизить затраты", causal_node_ids: ["margin"] },
  { id: "brand_building", label: "Бренд", description: "Строить бренд", causal_node_ids: ["lead_count"] },
];

describe("simulateScenario", () => {
  it("детерминизм: один seed → один результат", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    const r1 = simulateScenario(PLAN, LEVERS_LOW, [], BASE_FORECAST, rng1, () => "00000000-0000-0000-0000-000000000000");
    const r2 = simulateScenario(PLAN, LEVERS_LOW, [], BASE_FORECAST, rng2, () => "00000000-0000-0000-0000-000000000000");

    // confidence должен совпадать при одинаковом seed
    expect(r1.projectedForecast.confidence).toBe(r2.projectedForecast.confidence);
    expect(r1.impactOnGoal).toBe(r2.impactOnGoal);
  });

  it("complexity: 1 рычаг → low", () => {
    const result = simulateScenario(PLAN, LEVERS_LOW, [], BASE_FORECAST, mulberry32(1), () => "00000000-0000-0000-0000-000000000000");
    expect(result.complexity).toBe("low");
  });

  it("complexity: 2 рычага → medium", () => {
    const result = simulateScenario(PLAN, LEVERS_MED, [], BASE_FORECAST, mulberry32(2), () => "00000000-0000-0000-0000-000000000000");
    expect(result.complexity).toBe("medium");
  });

  it("complexity: 3+ рычагов → high", () => {
    const result = simulateScenario(PLAN, LEVERS_HIGH, [], BASE_FORECAST, mulberry32(3), () => "00000000-0000-0000-0000-000000000000");
    expect(result.complexity).toBe("high");
  });

  it("drivers ≤ 3 элементов", () => {
    const result = simulateScenario(PLAN, LEVERS_HIGH, [], BASE_FORECAST, mulberry32(4), () => "00000000-0000-0000-0000-000000000000");
    expect(result.drivers.length).toBeLessThanOrEqual(3);
  });

  it("gapAvoidedProbability в [0,1]", () => {
    const result = simulateScenario(PLAN, LEVERS_LOW, [], BASE_FORECAST, mulberry32(5), () => "00000000-0000-0000-0000-000000000000");
    expect(result.gapAvoidedProbability).toBeGreaterThanOrEqual(0);
    expect(result.gapAvoidedProbability).toBeLessThanOrEqual(1);
  });
});

describe("rankScenarios", () => {
  it("правильный порядок: low-complexity с высокой вероятностью — первый", () => {
    const low = simulateScenario(PLAN, LEVERS_LOW, [], BASE_FORECAST, mulberry32(10), () => "00000000-0000-0000-0000-000000000000");
    const high = simulateScenario(PLAN, LEVERS_HIGH, [], BASE_FORECAST, mulberry32(11), () => "00000000-0000-0000-0000-000000000000");
    // Принудительно задаём чтобы тест был детерминированным
    const fakeHigh = { ...high, gapAvoidedProbability: 0.3, projectedForecast: { ...high.projectedForecast, confidence: 0.3 }, complexity: "high" as const };
    const fakeLow  = { ...low,  gapAvoidedProbability: 0.8, projectedForecast: { ...low.projectedForecast, confidence: 0.8 }, complexity: "low" as const };

    const ranked = rankScenarios([fakeHigh, fakeLow]);
    expect(ranked[0]).toBe(fakeLow);
    expect(ranked[1]).toBe(fakeHigh);
  });

  it("не мутирует входной массив", () => {
    const r1 = simulateScenario(PLAN, LEVERS_LOW, [], BASE_FORECAST, mulberry32(20), () => "00000000-0000-0000-0000-000000000000");
    const r2 = simulateScenario(PLAN, LEVERS_MED, [], BASE_FORECAST, mulberry32(21), () => "00000000-0000-0000-0000-000000000000");
    const input = [r2, r1];
    const ranked = rankScenarios(input);
    expect(input[0]).toBe(r2); // original not mutated
    expect(ranked).not.toBe(input);
  });
});

describe("buildPlanDiff", () => {
  it("пустые assumptions → заглушки per lever", () => {
    const diffs = buildPlanDiff({}, ["Масштабирование", "Автоматизация"]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0]?.field).toBe("lever");
    expect(diffs[0]?.humanReadable).toBe("Масштабирование");
  });

  it("с assumptions → корректные поля", () => {
    const diffs = buildPlanDiff(PLAN.assumptions, ["Масштабирование объёмов"]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.field).not.toBe("");
    expect(diffs[0]?.before).toBeTruthy();
    expect(diffs[0]?.after).toBeTruthy();
    expect(diffs[0]?.humanReadable).toContain("Масштабирование объёмов");
  });
});
