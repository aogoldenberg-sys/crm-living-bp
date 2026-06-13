import type { BusinessEvent, IsoDate, Kopecks } from "@crm/schemas";
import { type Result, ok, err } from "../types.js";
import { eventDate } from "../utils.js";

export interface PlanFactMetrics {
  totalIn: Kopecks;
  totalOut: Kopecks;
  /** totalIn − totalOut. Может быть отрицательным при кассовом разрыве. */
  netCash: Kopecks;
  dealsCount: number;
  leadsCount: number;
  callsCount: number;
  /** null когда dealsCount = 0 — делить на ноль нельзя, UI обязан обработать null явно. */
  avgDealAmount: Kopecks | null;
  periodFrom: IsoDate;
  periodTo: IsoDate;
}

/** Принадлежность события периоду через его каноническую дату (из utils.eventDate). */
function isInPeriod(e: BusinessEvent, from: IsoDate, to: IsoDate): boolean {
  const d = eventDate(e);
  return d >= from && d <= to;
}

/**
 * Агрегируем append-only лог событий в плановые/фактические метрики за период.
 * PaymentCorrection — компенсирующее событие: аннулирует исходный платёж.
 * Реализация: собираем id аннулированных событий в Set, пропускаем их через continue.
 * Не вычитание из суммы, а исключение из выборки — это важно для корректного P&L.
 *
 * Пустой массив — легальный вход (нет данных за период), не ошибка.
 * Невалидный период (from > to) — ошибка, дашборд не должен показывать мусор.
 */
export function aggregateEvents(
  events: BusinessEvent[],
  period: { from: IsoDate; to: IsoDate },
): Result<PlanFactMetrics> {
  if (period.from > period.to) {
    return err({ code: "INVALID_PERIOD", message: `from (${period.from}) > to (${period.to})` });
  }

  // Индекс eventId → событие для быстрого поиска при обработке коррекций.
  const eventById = new Map<string, BusinessEvent>();
  for (const e of events) {
    eventById.set(e.eventId, e);
  }

  // Собираем id событий, аннулированных коррекциями, попавшими в период.
  const cancelledIds = new Set<string>();
  for (const e of events) {
    if (e.type === "payment_correction" && isInPeriod(e, period.from, period.to)) {
      cancelledIds.add(e.correctedEventId);
    }
  }

  let totalIn: Kopecks = 0;
  let totalOut: Kopecks = 0;
  let dealsCount = 0;
  let leadsCount = 0;
  let callsCount = 0;
  let dealAmountSum: Kopecks = 0;
  let dealAmountCount = 0;

  for (const e of events) {
    if (cancelledIds.has(e.eventId)) continue;

    if (!isInPeriod(e, period.from, period.to)) continue;

    if (e.type === "payment_in") {
      totalIn += e.amount;
    } else if (e.type === "payment_out") {
      totalOut += e.amount;
    } else if (e.type === "deal_stage_changed") {
      dealsCount++;
      if (e.estimatedAmount !== null) {
        dealAmountSum += e.estimatedAmount;
        dealAmountCount++;
      }
    } else if (e.type === "lead_captured") {
      leadsCount++;
    } else if (e.type === "call_logged") {
      callsCount++;
    }
  }

  const avgDealAmount: Kopecks | null = dealAmountCount > 0
    ? Math.round(dealAmountSum / dealAmountCount)
    : null;

  return ok({
    totalIn,
    totalOut,
    netCash: totalIn - totalOut,
    dealsCount,
    leadsCount,
    callsCount,
    avgDealAmount,
    periodFrom: period.from,
    periodTo: period.to,
  });
}
