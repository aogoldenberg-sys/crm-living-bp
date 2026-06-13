import { normalSample } from "./prng.js";
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
 * rng передаётся снаружи — функция чистая и детерминированная при том же rng.
 */
export function simulateOnce(
  initialBalance: number,
  plan: ForecastPlan,
  config: ForecastConfig,
  rng: () => number,
): number[] {
  const { horizonDays, revenueVolatility, paymentDelayDays, paymentDelayStdDev, leadDropoutRate } = config;

  // A-fix: не генерируем сделки в хвосте окна — их платежи не попадут в горизонт.
  const dealGenerationHorizon = Math.max(0, horizonDays - Math.ceil(paymentDelayDays));

  const incoming: number[] = new Array(horizonDays).fill(0) as number[];

  for (let dealDay = 0; dealDay < dealGenerationHorizon; dealDay++) {
    // Волатильность применяется к числу сделок сегодня, а не к сумме:
    // реальный бизнес-риск — непредсказуемый поток, не размер чека.
    const sampledDeals = plan.expectedDailyDeals * Math.max(0, 1 + normalSample(0, revenueVolatility, rng));
    const todayDeals = Math.round(sampledDeals);

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

  const balances: number[] = new Array(horizonDays).fill(0) as number[];
  let balance = initialBalance;

  for (let day = 0; day < horizonDays; day++) {
    balance = balance + (incoming[day] ?? 0) - plan.fixedDailyOutflow;
    balances[day] = balance;
  }

  return balances;
}
