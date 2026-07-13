import { randomUUID } from "node:crypto";
import type { BusinessEvent, BusinessPlanV1, IsoDate, StrategyLever } from "@crm/schemas";
import type { ScenarioResult } from "@crm/schemas";
import { forecastCash } from "../forecast/forecast.js";
import type { ForecastConfig, ForecastPlan, CashForecast } from "../forecast/types.js";

// РЕШЕНИЕ: базовый прогноз передаётся снаружи — не пересчитываем его здесь.
// Это позволяет сравнивать сценарий с одним и тем же baseline.

const DEFAULT_CONFIG: ForecastConfig = {
  horizonDays: 90,
  iterations: 500,        // меньше чем prod (10k) — достаточно для сравнения сценариев
  revenueVolatility: 0.15,
  paymentDelayDays: 14,
  paymentDelayStdDev: 5,
  leadDropoutRate: 0.2,
};

function applyLever(plan: ForecastPlan, lever: StrategyLever): ForecastPlan {
  switch (lever.id) {
    case "scale":
    case "value_innovation":
      return { ...plan, expectedDailyDeals: plan.expectedDailyDeals * 1.3 };
    case "process_automation":
    case "cost_structure":
      return { ...plan, fixedDailyOutflow: Math.round(plan.fixedDailyOutflow * 0.85) };
    case "premium_service":
    case "brand_building":
      return { ...plan, avgDealAmountKopecks: Math.round(plan.avgDealAmountKopecks * 1.2) };
    case "pilot":
    case "expansion":
      return { ...plan, expectedDailyDeals: plan.expectedDailyDeals * 1.15 };
    case "expertise":
    case "community":
      return {
        ...plan,
        avgDealAmountKopecks: Math.round(plan.avgDealAmountKopecks * 1.1),
        expectedDailyDeals: plan.expectedDailyDeals * 1.1,
      };
    default:
      return plan;
  }
}

function grossImpact(basePlan: ForecastPlan, modPlan: ForecastPlan): number {
  const baseDaily = basePlan.expectedDailyDeals * basePlan.avgDealAmountKopecks - basePlan.fixedDailyOutflow;
  const modDaily  = modPlan.expectedDailyDeals * modPlan.avgDealAmountKopecks - modPlan.fixedDailyOutflow;
  return Math.round((modDaily - baseDaily) * 90);
}

function planFromAssumptions(assumptions: BusinessPlanV1["assumptions"]): ForecastPlan {
  const avgDeal    = (assumptions["avg_deal_amount"]?.value as { point?: number } | undefined)?.point ?? 100_000_00;
  const dailyOut   = (assumptions["fixed_daily_outflow"]?.value as { point?: number } | undefined)?.point ?? 50_000_00;
  const dailyDeals = (assumptions["expected_daily_deals"]?.value as { point?: number } | undefined)?.point ?? 1;
  return {
    startDate: new Date().toISOString().slice(0, 10) as IsoDate,
    fixedDailyOutflow: Math.round(dailyOut),
    expectedDailyDeals: dailyDeals,
    avgDealAmountKopecks: Math.round(avgDeal),
  };
}

/**
 * Симулирует один сценарий с заданным набором рычагов.
 * Переиспользует forecastCash — Монте-Карло не дублируется.
 * rng инжектируется снаружи для детерминизма в тестах.
 */
export function simulateScenario(
  plan: BusinessPlanV1,
  levers: StrategyLever[],
  events: BusinessEvent[],
  baseForecast: CashForecast,
  rng: () => number,
): ScenarioResult {
  const runId = randomUUID();
  const scenarioId = randomUUID();

  const basePlan = planFromAssumptions(plan.assumptions);

  let modPlan = basePlan;
  for (const lever of levers) {
    modPlan = applyLever(modPlan, lever);
  }

  const forecastResult = forecastCash(events, modPlan, DEFAULT_CONFIG, rng);
  const projected = forecastResult.ok
    ? forecastResult.value
    : { gapDate: null, gapAmount: null, confidence: 0 };

  const baseHasGap = baseForecast.gapDate !== null;
  const projectedHasGap = projected.gapDate !== null;

  const gapAvoidedProbability = baseHasGap && !projectedHasGap
    ? 0.85
    : !baseHasGap
      ? projected.confidence
      : Math.max(0, projected.confidence - baseForecast.confidence);

  const drivers = levers.slice(0, 3).map(l => l.label);

  const complexity: ScenarioResult["complexity"] =
    levers.length === 1 ? "low" : levers.length === 2 ? "medium" : "high";

  return {
    scenarioId,
    runId,
    levers: levers.map(l => l.label),
    projectedForecast: {
      gapDate: projected.gapDate ?? null,
      gapAmount: projected.gapAmount ?? null,
      confidence: projected.confidence,
    },
    gapAvoidedProbability: Math.min(1, Math.max(0, gapAvoidedProbability)),
    impactOnGoal: grossImpact(basePlan, modPlan),
    complexity,
    drivers,
  };
}
