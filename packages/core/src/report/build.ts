import { randomUUID } from "node:crypto";
import type { BusinessEvent } from "@crm/schemas";
import type { OwnerReport, Deviation } from "@crm/schemas";
import { aggregateEvents } from "../planfact/aggregate.js";
import type { CashForecast } from "../forecast/types.js";

const MIN_EVENTS_FOR_CONFIDENCE = 10;

function weekBounds(now: string): { from: string; to: string } {
  const d = new Date(now);
  const dayOfWeek = d.getUTCDay(); // 0=Sun
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon=0
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - daysBack - 7);
  mon.setUTCHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return {
    from: mon.toISOString().slice(0, 10),
    to: sun.toISOString().slice(0, 10),
  };
}

function topDeviations(metrics: ReturnType<typeof aggregateEvents>): Deviation[] {
  if (!metrics.ok) return [];
  const m = metrics.value;
  const pairs: Array<{ metric: string; plan: number; fact: number }> = [
    { metric: "revenue", plan: m.totalIn, fact: m.totalIn },   // plan unknown → skip
    { metric: "deals", plan: m.dealsCount * 100, fact: m.dealsCount * 100 },
  ];

  return pairs
    .filter(p => p.plan > 0 && Math.abs((p.fact - p.plan) / p.plan * 100) > 1)
    .slice(0, 3)
    .map(p => ({
      metric: p.metric,
      planValue: p.plan,
      factValue: p.fact,
      deviationPct: Math.round((p.fact - p.plan) / p.plan * 10000) / 100,
      causeChain: [],
    }));
}

/**
 * Собирает OwnerReport из событий лога и уже посчитанного прогноза.
 * Не вызывает AI, не делает fetch. Только агрегация.
 */
export function buildOwnerReport(
  businessId: string,
  events: BusinessEvent[],
  forecast: CashForecast | null,
  now: string,
): OwnerReport {
  const { from, to } = weekBounds(now);
  const metricsResult = aggregateEvents(events, { from, to });
  const hasData = metricsResult.ok && events.length >= MIN_EVENTS_FOR_CONFIDENCE;

  const balance = metricsResult.ok ? metricsResult.value.netCash : 0;
  const deviations = topDeviations(metricsResult);

  const confidence = !hasData
    ? 0.2
    : forecast !== null
      ? forecast.confidence
      : 0.4;

  const recommendation: string | null = !hasData
    ? null
    : forecast?.gapDate
      ? `Ожидается кассовый разрыв ~${forecast.gapDate}. Рекомендуется ускорить сбор дебиторки.`
      : null;

  return {
    reportId: randomUUID(),
    businessId,
    periodStart: from,
    periodEnd: to,
    generatedAt: now as `${string}T${string}Z`,
    cash: {
      balance,
      gapDate: forecast?.gapDate ?? null,
      gapAmount: forecast?.gapDate && forecast.gapAmount ? forecast.gapAmount : null,
      confidence,
    },
    topDeviations: deviations,
    recommendation,
    deliveredTo: [],
  };
}
