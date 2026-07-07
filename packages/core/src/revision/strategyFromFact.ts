import type { BusinessEvent } from "@crm/schemas";

export type StrategyVerdict =
  | "keep_current"
  | "new_strategy"
  | "insufficient_data";

export type StrategyResult = {
  verdict: StrategyVerdict;
  rationale: string;
  goals: string[];
};

const MIN_EVENTS = 6;
const MIN_CALENDAR_MONTHS = 2;

// Считаем уникальные календарные месяцы — надёжнее чем дни для коротких периодов
// payment_correction не имеет valueDate — исключаем его
function distinctMonths(events: readonly BusinessEvent[]): number {
  const months = new Set<string>();
  for (const e of events) {
    if ("valueDate" in e) months.add((e as { valueDate: string }).valueDate.slice(0, 7));
  }
  return months.size;
}

export function strategyFromFact(
  events: readonly BusinessEvent[],
  currentAssumptions: Record<string, unknown>,
): StrategyResult {
  void currentAssumptions; // используется только как контекст для будущих расширений

  const paymentsIn = events.filter(e => e.type === "payment_in") as Extract<BusinessEvent, { type: "payment_in" }>[];
  const calMonths = distinctMonths(events);

  if (events.length < MIN_EVENTS || calMonths < MIN_CALENDAR_MONTHS) {
    return {
      verdict: "insufficient_data",
      rationale: `Недостаточно данных: ${events.length} событий за ${calMonths} кал. мес. Нужно ≥${MIN_EVENTS} событий и ≥${MIN_CALENDAR_MONTHS} мес.`,
      goals: [],
    };
  }

  const totalRevenue = paymentsIn.reduce((s, e) => s + e.amount, 0);
  const avgMonthly = totalRevenue / Math.max(calMonths, 1);

  const months = new Map<string, number>();
  for (const e of paymentsIn) {
    const key = e.valueDate.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + e.amount);
  }
  const sorted = Array.from(months.values());

  if (sorted.length >= 2) {
    const last = sorted[sorted.length - 1] ?? 0;
    const prev = sorted[sorted.length - 2] ?? 1;
    const growthRate = prev > 0 ? (last - prev) / prev : 0;

    if (growthRate >= 0.15) {
      return {
        verdict: "keep_current",
        rationale: `Рост выручки ${(growthRate * 100).toFixed(1)}% за последний месяц. Текущая стратегия работает.`,
        goals: [
          `Удержать темп роста ≥15% м/м`,
          `Среднемесячная выручка: ${Math.round(avgMonthly / 100).toLocaleString("ru-RU")} ₽`,
        ],
      };
    }
  }

  return {
    verdict: "new_strategy",
    rationale: "Рост выручки ниже 15% м/м или отрицательный. Рекомендуется пересмотр стратегии.",
    goals: [
      "Провести анализ оттока клиентов",
      "Проверить ценовую политику",
      `Целевая выручка: +20% к текущей ${Math.round(avgMonthly / 100).toLocaleString("ru-RU")} ₽/мес`,
    ],
  };
}
