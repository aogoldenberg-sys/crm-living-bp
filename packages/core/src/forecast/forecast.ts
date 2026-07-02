import type { BusinessEvent, IsoDate, Kopecks } from "@crm/schemas";
import { type Result, ok, err } from "../types.js";
import { EPOCH_START } from "../utils.js";
import { aggregateEvents } from "../planfact/aggregate.js";
import { simulateOnce } from "./simulate.js";
import { computePercentiles } from "./percentile.js";
import type { ForecastConfig, ForecastPlan, CashForecast, DailyBalance } from "./types.js";

/**
 * Добавляет указанное число дней к IsoDate-строке.
 * Использует Date.getTime() для арифметики — единственный надёжный способ учесть
 * переходы месяцев и високосные годы без собственного календарного кода.
 * Результат обрезается до UTC-даты без компонента времени.
 */
function addDays(date: IsoDate, days: number): IsoDate {
  const ms = new Date(date).getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

/**
 * Главная функция прогноза кассы методом Монте-Карло.
 *
 * Почему MC, а не детерминированный расчёт: бизнес-параметры (задержка оплаты,
 * отвал лидов, волатильность выручки) — стохастические. MC даёт распределение
 * исходов вместо одной точки, что позволяет видеть вероятность разрыва,
 * а не просто «будет или нет».
 *
 * C2: Если среди events есть balance_anchor, используем последний якорь
 * как начальный баланс вместо суммы исторических событий.
 *
 * C5: generatedAt принимается параметром (опционально), по умолчанию plan.startDate.
 *
 * rng передаётся параметром: функция остаётся чистой и тесты детерминированы.
 */
export function forecastCash(
  events: BusinessEvent[],
  plan: ForecastPlan,
  config: ForecastConfig,
  rng: () => number,
  generatedAt?: IsoDate,
): Result<CashForecast> {
  if (config.horizonDays <= 0) {
    return err({ code: "INVALID_PERIOD", message: "horizonDays должен быть > 0" });
  }
  if (config.iterations <= 0) {
    return err({ code: "INVALID_PERIOD", message: "iterations должен быть > 0" });
  }

  // C2: Use latest balance_anchor as initial balance if available
  const latestAnchor = events
    .filter((e): e is Extract<BusinessEvent, { type: "balance_anchor" }> => e.type === "balance_anchor")
    .sort((a, b) => a.anchorDate.localeCompare(b.anchorDate))
    .at(-1);

  let initialBalance: number;

  if (latestAnchor) {
    initialBalance = latestAnchor.balanceKopecks;
  } else {
    // Начальный баланс = net cash за всю историю событий (period = вся история).
    const aggregateResult = aggregateEvents(events, { from: EPOCH_START, to: plan.startDate });
    if (!aggregateResult.ok) return aggregateResult;
    initialBalance = aggregateResult.value.netCash;
  }

  // Матрица: iterations × horizonDays. Транспонируем после симуляций.
  const allRuns: number[][] = [];
  let noGapCount = 0;

  for (let i = 0; i < config.iterations; i++) {
    const run = simulateOnce(initialBalance, plan, config, rng);
    allRuns.push(run);

    // Итерация "без разрыва" = баланс >= 0 во все дни.
    const hasGap = run.some((b) => b < 0);
    if (!hasGap) noGapCount++;
  }

  // Транспонируем: для каждого дня собираем значения всех итераций.
  const dailyBalances: DailyBalance[] = [];
  let gapDate: IsoDate | null = null;
  let gapAmount: Kopecks | null = null;
  let hardGapDate: IsoDate | null = null;
  let pessimisticGapDate: IsoDate | null = null;

  for (let day = 0; day < config.horizonDays; day++) {
    const dayValues: number[] = allRuns.map((run) => run[day] ?? 0);
    const { p10, p50, p90 } = computePercentiles(dayValues);

    const date = addDays(plan.startDate, day);
    const roundedP10 = Math.round(p10) as Kopecks;
    const roundedP50 = Math.round(p50) as Kopecks;
    const roundedP90 = Math.round(p90) as Kopecks;

    dailyBalances.push({ date, p10: roundedP10, p50: roundedP50, p90: roundedP90 });

    // C1: Main gap: p50 < 0 (медианный сценарий)
    if (gapDate === null && roundedP50 < 0) {
      gapDate = date;
      gapAmount = roundedP50;
    }
    // C1: Hard gap: p90 < 0 (оптимистичный сценарий тоже не выживает)
    if (hardGapDate === null && roundedP90 < 0) {
      hardGapDate = date;
    }
    // C1: Pessimistic gap: p10 < 0 (ранний тревожный сигнал)
    if (pessimisticGapDate === null && roundedP10 < 0) {
      pessimisticGapDate = date;
    }
  }

  const confidence = noGapCount / config.iterations;

  return ok({
    generatedAt: generatedAt ?? plan.startDate,
    horizonDays: config.horizonDays,
    dailyBalances,
    gapDate,
    gapAmount,
    hardGapDate,
    pessimisticGapDate,
    confidence,
  });
}
