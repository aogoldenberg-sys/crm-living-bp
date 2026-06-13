import { describe, it, expect } from "vitest";
import { mulberry32 } from "./prng.js";
import { simulateOnce } from "./simulate.js";
import type { ForecastConfig, ForecastPlan } from "./types.js";

const plan: ForecastPlan = {
  startDate: "2026-01-01",
  fixedDailyOutflow: 10_000_00, // 10 000 руб/день
  expectedDailyDeals: 3,
  avgDealAmountKopecks: 50_000_00, // 50 000 руб средний чек
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
    const rng = mulberry32(42);
    const result = simulateOnce(0, plan, config, rng);

    expect(result).toHaveLength(30);
  });

  it("детерминирован при одном seed", () => {
    const result1 = simulateOnce(0, plan, config, mulberry32(42));
    const result2 = simulateOnce(0, plan, config, mulberry32(42));

    expect(result1).toEqual(result2);
  });

  it("начальный баланс влияет на все значения", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const withBalance = simulateOnce(1_000_000_00, plan, config, rng1);
    const withZero = simulateOnce(0, plan, config, rng2);

    // Каждый день разница равна начальному балансу.
    for (let i = 0; i < 30; i++) {
      expect((withBalance[i] ?? 0) - (withZero[i] ?? 0)).toBeCloseTo(1_000_000_00, 0);
    }
  });

  it("при нулевых сделках баланс монотонно убывает", () => {
    const zeroDealPlan: ForecastPlan = { ...plan, expectedDailyDeals: 0 };
    const rng = mulberry32(42);
    const result = simulateOnce(10_000_000_00, zeroDealPlan, config, rng);

    for (let i = 1; i < result.length; i++) {
      expect(result[i] ?? 0).toBeLessThan(result[i - 1] ?? 0);
    }
  });
});
