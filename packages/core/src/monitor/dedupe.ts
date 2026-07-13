import type { ExternalSignal, DemandTrendPoint, CounterpartyRiskSignal } from "@crm/schemas";

type MonitorSignal = ExternalSignal | DemandTrendPoint | CounterpartyRiskSignal;

function signalHash(s: MonitorSignal): string {
  if (s.type === "external_signal") {
    return `${s.source}|${s.url ?? ""}|${s.title}`;
  }
  if (s.type === "demand_trend") {
    return `${s.source}|${s.keyword}|${s.period}`;
  }
  // counterparty_risk
  return `${s.inn}|${s.checkId}|${s.severity}`;
}

/**
 * Фильтрует incoming, оставляя только сигналы, которых нет в existing.
 * Дедупликация по хэшу (source+url+title), не по eventId — повторный прогон
 * одного источника не порождает дублей.
 */
export function dedupeSignals<T extends MonitorSignal>(
  existing: T[],
  incoming: T[],
): T[] {
  const seen = new Set(existing.map(signalHash));
  return incoming.filter(s => !seen.has(signalHash(s)));
}
