import { describe, it, expect } from "vitest";
import { mulberry32 } from "./prng.js";
import { simulateOnce } from "./simulate.js";
import type { ForecastConfig, ForecastPlan } from "./types.js";

const plan: ForecastPlan = {
  startDate: "2026-01-01",
  fixedDailyOutflow: 10_000_00,
  expectedDailyDeals: 3,
  avgDealAmountKopecks: 50_000_00,
};

const config: ForecastConfig = {
  horizonDays: 30,
  iterations: 1,
  revenueVolatility: 0.15,
  paymentDelayDays: 2,
  paymentDelayStdDev: 1,
  leadDropoutRate: 0.1,
};

describe("simulateOnce", () => {
  it("возвращает массив длиной horizonDays", () => {
    const result = simulateOnce(0, plan, config, mulberry32(42));
    expect(result).toHaveLength(30);
  });

  it("детерминирован при одном seed", () => {
    const r1 = simulateOnce(0, plan, config, mulberry32(42));
    const r2 = simulateOnce(0, plan, config, mulberry32(42));
    expect(r1).toEqual(r2);
  });

  it("при нулевых сделках баланс монотонно убывает на fixedDailyOutflow", () => {
    const zeroDealPlan: ForecastPlan = { ...plan, expectedDailyDeals: 0 };
    const result = simulateOnce(10_000_000_00, zeroDealPlan, config, mulberry32(42));
    for (let i = 1; i < result.length; i++) {
      expect(result[i] ?? 0).toBeLessThan(result[i - 1] ?? 0);
    }
  });

  it("A-fix: хвост горизонта не занижен — последние paymentDelayDays дней не получают новых сделок, но балансы вычисляются", () => {
    // paymentDelayDays=5 → dealGenerationHorizon = 30 - 5 = 25.
    // Дни 25-29 накапливают только incoming от предыдущих сделок + fixedDailyOutflow.
    // Тест проверяет: массив всё равно полной длины.
    const delayedConfig: ForecastConfig = { ...config, paymentDelayDays: 5, paymentDelayStdDev: 0 };
    const result = simulateOnce(0, plan, delayedConfig, mulberry32(42));
    expect(result).toHaveLength(30);
  });

  it("B-fix: leadDropoutRate=1 → все сделки отваливаются, баланс убывает как при нулевых сделках", () => {
    const fullDropoutConfig: ForecastConfig = { ...config, leadDropoutRate: 1, revenueVolatility: 0 };
    const result = simulateOnce(10_000_000_00, plan, fullDropoutConfig, mulberry32(42));
    // Каждый день: balance -= fixedDailyOutflow, без поступлений.
    for (let i = 1; i < result.length; i++) {
      expect(result[i] ?? 0).toBeLessThan(result[i - 1] ?? 0);
    }
  });
});
