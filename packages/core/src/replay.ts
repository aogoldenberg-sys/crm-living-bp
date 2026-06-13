import type { BusinessEvent, IsoDate } from "@crm/schemas";
import { type Result, ok } from "./types.js";
import { eventDate, EPOCH_START } from "./utils.js";
import { aggregateEvents, type PlanFactMetrics } from "./planfact/aggregate.js";
import { deriveAlerts, type Alert, type PlanAssumptions } from "./planfact/alerts.js";
import { forecastCash } from "./forecast/forecast.js";
import type { ForecastConfig, ForecastPlan, CashForecast } from "./forecast/types.js";

export interface ReplayState {
  /** Дата среза — «что знала система на конец этого дня». */
  asOfDate: IsoDate;
  /** Число событий, попавших в окно [−∞, date]. */
  eventsConsidered: number;
  /** Агрегированные plan/fact-метрики за всю историю до date включительно. */
  metrics: PlanFactMetrics;
  /** Алерты, выведенные из metrics и assumptions. */
  alerts: Alert[];
  /** Прогноз кассы вперёд от date. */
  forecast: CashForecast;
}

/**
 * Фильтрует события: оставляет только те, чья каноническая дата <= date.
 * Не мутирует исходный массив — filter создаёт новый.
 * eventDate импортируется из utils — единый источник истины для логики дат.
 */
function filterUpTo(events: BusinessEvent[], date: IsoDate): BusinessEvent[] {
  return events.filter((e) => eventDate(e) <= date);
}

/**
 * Главная функция «машины времени»: восстанавливает полное состояние системы
 * на конец дня date из append-only лога событий.
 *
 * Оркестратор, а не движок: вся бизнес-логика делегируется aggregateEvents,
 * deriveAlerts, forecastCash. replay не знает о формулах — только о порядке вызовов.
 *
 * Почему plan.startDate переопределяется в date: прогноз строится «вперёд от среза».
 * Оригинальный startDate плана — точка создания плана, а не точка наблюдения.
 * Подставляем date, чтобы forecastCash считал начальный баланс корректно
 * (aggregateEvents внутри forecastCash агрегирует историю до plan.startDate).
 *
 * Пустая история — легальный вход: aggregateEvents вернёт нулевые метрики,
 * deriveAlerts вернёт [], forecastCash посчитает прогноз от нулевого баланса.
 */
export function replayAt(
  events: BusinessEvent[],
  date: IsoDate,
  plan: ForecastPlan,
  assumptions: PlanAssumptions,
  config: ForecastConfig,
  rng: () => number,
): Result<ReplayState> {
  // Не мутируем вход — filter создаёт новый массив.
  const filtered = filterUpTo(events, date);

  const aggregateResult = aggregateEvents(filtered, { from: EPOCH_START, to: date });
  // aggregateEvents может вернуть ошибку только при from > to.
  // from = "2000-01-01" всегда <= date (IsoDate валидируется на входе схемой),
  // но пробрасываем ошибку для полноты контракта Result.
  if (!aggregateResult.ok) return aggregateResult;

  const metrics = aggregateResult.value;
  const alerts = deriveAlerts(metrics, assumptions);

  // Прогноз строится от даты среза, не от оригинального startDate плана.
  const planFromDate: ForecastPlan = { ...plan, startDate: date };
  const forecastResult = forecastCash(filtered, planFromDate, config, rng);
  if (!forecastResult.ok) return forecastResult;

  return ok({
    asOfDate: date,
    eventsConsidered: filtered.length,
    metrics,
    alerts,
    forecast: forecastResult.value,
  });
}
