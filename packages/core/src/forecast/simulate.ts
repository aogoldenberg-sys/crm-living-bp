import { normalSample } from "./prng.js";
import type { ForecastConfig, ForecastPlan } from "./types.js";

/**
 * Одна MC-итерация: симулирует движение кассы по дням горизонта.
 * Возвращает массив балансов length === horizonDays в копейках (float до округления).
 *
 * Алгоритм входящих по заданию:
 *   incoming[day] = deals × (1 + N(0,σ)) × P(payment arrives on this day)
 * где P(day) определяется нормальным CDF со сдвигом paymentDelayDays.
 * Отвал лида применяется как скаляр (1 − leadDropoutRate) к базовой выручке.
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

  // Ожидаемая дневная выручка с поправкой на отвал лидов.
  const baseDailyRevenue = plan.expectedDailyDeals * plan.avgDealAmountKopecks * (1 - leadDropoutRate);

  // Для каждого дня сэмплируем задержку оплаты и волатильность.
  // Каждый день горизонта генерирует сделки; деньги от них приходят через delayDays дней.
  // Мы накапливаем входящие в будущие дни по сэмплированной задержке.
  const incoming: number[] = new Array(horizonDays).fill(0) as number[];

  for (let dealDay = 0; dealDay < horizonDays; dealDay++) {
    const volatilityFactor = 1 + normalSample(0, revenueVolatility, rng);
    const dailyRevenue = baseDailyRevenue * Math.max(0, volatilityFactor);

    // Задержка оплаты: сколько дней от сделки до зачисления.
    const delay = Math.round(Math.max(0, normalSample(paymentDelayDays, paymentDelayStdDev, rng)));
    const paymentDay = dealDay + delay;

    if (paymentDay < horizonDays) {
      // noUncheckedIndexedAccess: оператор ! безопасен — индекс проверен выше.
      incoming[paymentDay] = (incoming[paymentDay] ?? 0) + dailyRevenue;
    }
    // Деньги за пределами горизонта просто не попадают в прогноз.
  }

  const balances: number[] = new Array(horizonDays).fill(0) as number[];
  let balance = initialBalance;

  for (let day = 0; day < horizonDays; day++) {
    balance = balance + (incoming[day] ?? 0) - plan.fixedDailyOutflow;
    balances[day] = balance;
  }

  return balances;
}
