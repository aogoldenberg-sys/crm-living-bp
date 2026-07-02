import { normalSample, poissonSample } from "./prng.js";
import type { ForecastConfig, ForecastPlan } from "./types.js";

/**
 * Одна MC-итерация: симулирует движение кассы по дням горизонта.
 * Возвращает массив балансов length === horizonDays в копейках.
 *
 * A-fix (truncation bias): сделки генерируются только до dealGenerationHorizon.
 * Последние paymentDelayDays дней не получают новых сделок — иначе их платежи
 * уйдут за горизонт и прогноз в хвосте будет систематически занижен.
 *
 * B-fix (stochastic dropout): каждая сделка независимо бросает монетку на отвал.
 * Детерминированный множитель (1-rate) убирал дисперсию — один из ключевых
 * источников риска в MC перестал работать.
 *
 * C3: Если plan.pipeline задан и не пуст, используем реальные сделки из CRM
 * вместо синтетического потока. pipeline[].probability определяет стохастику.
 *
 * C4: Для синтетического потока используем Poisson вместо normalSample —
 * дискретное неотрицательное распределение числа сделок.
 *
 * rng передаётся снаружи — функция чистая и детерминированная при том же rng.
 */
export function simulateOnce(
  initialBalance: number,
  plan: ForecastPlan,
  config: ForecastConfig,
  rng: () => number,
): number[] {
  const { horizonDays, paymentDelayDays, paymentDelayStdDev, leadDropoutRate } = config;

  const incoming: number[] = new Array(horizonDays).fill(0) as number[];

  // C3: Real pipeline deals
  if (plan.pipeline && plan.pipeline.length > 0) {
    for (const deal of plan.pipeline) {
      // Stochastic: deal wins with its probability
      if (rng() > deal.probability) continue; // lost

      // Payment day relative to startDate
      const paymentMs = new Date(deal.expectedPaymentDate).getTime() - new Date(plan.startDate).getTime();
      const paymentDay = Math.round(paymentMs / 86_400_000);

      if (paymentDay >= 0 && paymentDay < horizonDays) {
        incoming[paymentDay] = (incoming[paymentDay] ?? 0) + deal.amountKopecks;
      }
    }
  } else {
    // Fallback: synthetic deal flow with Poisson

    // A-fix: не генерируем сделки в хвосте окна — их платежи не попадут в горизонт.
    const dealGenerationHorizon = Math.max(0, horizonDays - Math.ceil(paymentDelayDays));

    for (let dealDay = 0; dealDay < dealGenerationHorizon; dealDay++) {
      // C4: Poisson для дискретного числа сделок (replaces normalSample which gave fractional/negative values)
      const todayDeals = poissonSample(plan.expectedDailyDeals, rng);

      for (let d = 0; d < todayDeals; d++) {
        // B-fix: каждая сделка независимо может отвалиться до оплаты.
        if (rng() < leadDropoutRate) continue;

        const delay = Math.round(Math.max(0, normalSample(paymentDelayDays, paymentDelayStdDev, rng)));
        const paymentDay = dealDay + delay;

        if (paymentDay < horizonDays) {
          incoming[paymentDay] = (incoming[paymentDay] ?? 0) + plan.avgDealAmountKopecks;
        }
      }
    }
  }

  const balances: number[] = new Array(horizonDays).fill(0) as number[];
  let balance = initialBalance;

  for (let day = 0; day < horizonDays; day++) {
    balance = balance + (incoming[day] ?? 0) - plan.fixedDailyOutflow;
    balances[day] = balance;
  }

  return balances;
}
