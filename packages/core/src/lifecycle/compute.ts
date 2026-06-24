import type { BusinessEvent } from "@crm/schemas";
import type { LifecycleInput, LifecycleResult, BusinessStage, StagePriority } from "./types.js";

const STAGE_LABELS: Record<BusinessStage, string> = {
  startup: "Старт",
  growth: "Разгон",
  maturity: "Зрелость",
  decline: "Спад",
};

const STAGE_PRIORITIES: Record<BusinessStage, StagePriority[]> = {
  startup: [
    { id: "validate", label: "Валидация гипотез", description: "Проверить спрос до масштабирования" },
    { id: "cashflow", label: "Денежный поток", description: "Контроль burn rate" },
    { id: "firstrevenue", label: "Первая выручка", description: "Довести до первой продажи" },
  ],
  growth: [
    { id: "scale", label: "Масштабирование", description: "Удерживать темп роста выручки" },
    { id: "unit", label: "Юнит-экономика", description: "Проверить рентабельность роста" },
    { id: "hiring", label: "Найм", description: "Команда под рост" },
  ],
  maturity: [
    { id: "efficiency", label: "Операционная эффективность", description: "Снизить удельные издержки" },
    { id: "retention", label: "Удержание клиентов", description: "LTV > CAC × 3" },
    { id: "newmarkets", label: "Новые рынки", description: "Точки следующего роста" },
  ],
  decline: [
    { id: "diagnose", label: "Диагностика", description: "Причины снижения выручки" },
    { id: "costs", label: "Оптимизация затрат", description: "Снизить OpEx" },
    { id: "pivot", label: "Пивот или выход", description: "Оценить варианты стратегии" },
  ],
};

/** Extract YYYY-MM from an ISO datetime string */
function toYearMonth(isoDatetime: string): string {
  return isoDatetime.slice(0, 7);
}

/** Compute months between two YYYY-MM strings (inclusive span) */
function monthsBetween(earliest: string, latest: string): number {
  const [ey, em] = earliest.split("-").map(Number) as [number, number];
  const [ly, lm] = latest.split("-").map(Number) as [number, number];
  return (ly - ey) * 12 + (lm - em);
}

function buildResult(
  stage: BusinessStage,
  rationale: string,
  historyMonths: number,
): LifecycleResult {
  return {
    stage,
    label: STAGE_LABELS[stage],
    rationale,
    priorities: STAGE_PRIORITIES[stage],
    historyMonths,
  };
}

export function computeBusinessStage(input: LifecycleInput): LifecycleResult {
  const { events, hasPlan } = input;

  // Collect only PaymentIn events
  const paymentIns = events.filter(
    (e): e is Extract<BusinessEvent, { type: "payment_in" }> => e.type === "payment_in",
  );

  // No events at all
  if (paymentIns.length === 0) {
    if (!hasPlan) {
      return buildResult("startup", "Нет данных и плана", 0);
    } else {
      return buildResult("startup", "Бизнес-план загружен, факт не поступал", 0);
    }
  }

  // Group PaymentIn by YYYY-MM, summing amounts
  const buckets = new Map<string, number>();
  for (const e of paymentIns) {
    const month = toYearMonth(e.ts);
    buckets.set(month, (buckets.get(month) ?? 0) + e.amount);
  }

  // Sort months chronologically
  const sortedMonths = Array.from(buckets.keys()).sort();
  const earliestMonth = sortedMonths[0]!;
  const latestMonth = sortedMonths[sortedMonths.length - 1]!;
  const historyMonths = monthsBetween(earliestMonth, latestMonth);

  // Fewer than 2 months of data
  if (sortedMonths.length < 2) {
    return buildResult("startup", "Менее 2 месяцев истории", historyMonths);
  }

  // Compute MoM growth rates between consecutive months
  const growthRates: number[] = [];
  for (let i = 1; i < sortedMonths.length; i++) {
    const prev = buckets.get(sortedMonths[i - 1]!)!;
    const curr = buckets.get(sortedMonths[i]!)!;
    if (prev === 0) {
      // Avoid division by zero — treat as large growth
      growthRates.push(Infinity);
    } else {
      growthRates.push((curr - prev) / prev);
    }
  }

  // Check last 2+ consecutive growth rates
  const lastRates = growthRates.slice(-Math.max(growthRates.length, 2));

  const allGrowing = lastRates.every((r) => r > 0.1);
  const allDeclining = lastRates.every((r) => r < -0.1);

  if (allGrowing) {
    return buildResult("growth", "Выручка растёт >10% MoM за последние месяцы", historyMonths);
  }

  if (allDeclining) {
    return buildResult("decline", "Выручка падает >10% MoM за последние месяцы", historyMonths);
  }

  return buildResult("maturity", "Стабильная выручка без устойчивого роста или падения", historyMonths);
}
