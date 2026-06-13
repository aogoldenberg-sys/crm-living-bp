import type { Kopecks } from "@crm/schemas";
import type { PlanFactMetrics } from "./aggregate.js";
import { computeDeviation } from "./deviation.js";

export interface PlanAssumptions {
  /** Плановая выручка за период в копейках. */
  revenuePlan: Kopecks;
  /** Плановые постоянные затраты за период в копейках. */
  fixedCostsPlan: Kopecks;
  /** Плановая конверсия лид→сделка в процентах (0–100). */
  conversionPct: number;
  /** Плановый CAC (стоимость привлечения клиента) в копейках. */
  cacPlan: Kopecks;
  /** Фактический CAC за период; 0 если лидов не было. */
  cacFact: Kopecks;
}

export interface Alert {
  metric: string;
  severity: "yellow" | "red";
  message: string;
  /** Отклонение в процентах — для метрик выручки, конверсии, CAC. */
  deviationPct: number;
  /**
   * Коэффициент покрытия постоянных затрат — только для metric === "cash_balance".
   * Отдельное поле, чтобы UI не путал 1.2× (покрытие) с −12% (отклонение).
   */
  coverageRatio?: number;
}

/**
 * Пороги отклонений из §3 архитектуры.
 * Хранятся как данные, а не «магические числа» — легко тестировать и менять.
 */
const THRESHOLDS = {
  revenue:    { yellow: -10, red: -20 },
  conversion: { yellow: -15, red: -30 },
  cac:        { yellow: +15, red: +30 },  // рост CAC — плохо, порог положительный
  cashBalance: { yellow: 1.5, red: 1.0 }, // коэффициент покрытия постоянных затрат
} as const;

function revenueAlerts(metrics: PlanFactMetrics, plan: PlanAssumptions): Alert[] {
  if (plan.revenuePlan === 0) return [];
  const result = computeDeviation(metrics.totalIn, plan.revenuePlan);
  if (!result.ok) return [];
  const { deviationPct } = result.value;

  if (deviationPct <= THRESHOLDS.revenue.red) {
    return [{ metric: "revenue", severity: "red", deviationPct,
      message: `Выручка ниже плана на ${Math.abs(deviationPct).toFixed(1)}% (критично)` }];
  }
  if (deviationPct <= THRESHOLDS.revenue.yellow) {
    return [{ metric: "revenue", severity: "yellow", deviationPct,
      message: `Выручка ниже плана на ${Math.abs(deviationPct).toFixed(1)}%` }];
  }
  return [];
}

function conversionAlerts(metrics: PlanFactMetrics, plan: PlanAssumptions): Alert[] {
  if (plan.conversionPct === 0 || metrics.leadsCount === 0) return [];
  const factConversionPct = (metrics.dealsCount / metrics.leadsCount) * 100;
  const result = computeDeviation(factConversionPct, plan.conversionPct);
  if (!result.ok) return [];
  const { deviationPct } = result.value;

  if (deviationPct <= THRESHOLDS.conversion.red) {
    return [{ metric: "conversion", severity: "red", deviationPct,
      message: `Конверсия воронки ниже плана на ${Math.abs(deviationPct).toFixed(1)}% (критично)` }];
  }
  if (deviationPct <= THRESHOLDS.conversion.yellow) {
    return [{ metric: "conversion", severity: "yellow", deviationPct,
      message: `Конверсия воронки ниже плана на ${Math.abs(deviationPct).toFixed(1)}%` }];
  }
  return [];
}

function cacAlerts(plan: PlanAssumptions): Alert[] {
  if (plan.cacPlan === 0 || plan.cacFact === 0) return [];
  const result = computeDeviation(plan.cacFact, plan.cacPlan);
  if (!result.ok) return [];
  const { deviationPct } = result.value;

  if (deviationPct >= THRESHOLDS.cac.red) {
    return [{ metric: "cac", severity: "red", deviationPct,
      message: `CAC вырос на ${deviationPct.toFixed(1)}% выше плана (критично)` }];
  }
  if (deviationPct >= THRESHOLDS.cac.yellow) {
    return [{ metric: "cac", severity: "yellow", deviationPct,
      message: `CAC вырос на ${deviationPct.toFixed(1)}% выше плана` }];
  }
  return [];
}

/**
 * Кассовый остаток — netCash соотносим с постоянными затратами.
 * coverageRatio (коэффициент покрытия) хранится отдельно от deviationPct —
 * 1.2× и −12% это разные смыслы, UI не должен их смешивать.
 * deviationPct = 0 для cash_balance: процентное отклонение здесь неприменимо.
 */
function cashBalanceAlerts(metrics: PlanFactMetrics, plan: PlanAssumptions): Alert[] {
  if (plan.fixedCostsPlan === 0) return [];
  const coverageRatio = Math.round((metrics.netCash / plan.fixedCostsPlan) * 100) / 100;

  if (coverageRatio < THRESHOLDS.cashBalance.red) {
    return [{ metric: "cash_balance", severity: "red", deviationPct: 0, coverageRatio,
      message: `Кассовый остаток покрывает ${coverageRatio.toFixed(2)}× постоянных затрат (критично < 1.0×)` }];
  }
  if (coverageRatio < THRESHOLDS.cashBalance.yellow) {
    return [{ metric: "cash_balance", severity: "yellow", deviationPct: 0, coverageRatio,
      message: `Кассовый остаток покрывает ${coverageRatio.toFixed(2)}× постоянных затрат (< 1.5×)` }];
  }
  return [];
}

/**
 * Основная точка входа для генерации алертов.
 * Чистая функция: одинаковые метрики + план → одинаковые алерты.
 * Порядок: выручка → конверсия → CAC → кассовый остаток (по убыванию срочности).
 */
export function deriveAlerts(
  metrics: PlanFactMetrics,
  plan: PlanAssumptions,
): Alert[] {
  return [
    ...revenueAlerts(metrics, plan),
    ...conversionAlerts(metrics, plan),
    ...cacAlerts(plan),
    ...cashBalanceAlerts(metrics, plan),
  ];
}
