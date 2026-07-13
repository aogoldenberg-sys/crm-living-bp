/**
 * Адаптер kad.arbitr — ЗАГЛУШКА.
 *
 * Официального публичного API у kad.arbitr.ru нет.
 * Скрейпинг запрещён (robots.txt + ТОС).
 *
 * ПЛАН: подключить через n8n-workflow с Playwright-нодой:
 *   1. n8n триггер по расписанию → Playwright → kad.arbitr поиск по ИНН
 *   2. Результат → POST /external на ingest-воркер
 *   3. ingest создаёт CounterpartyRiskSignal с source:"kad_arbitr"
 *
 * До реализации n8n-workflow этот адаптер всегда возвращает [] + status:"disabled".
 */

import type { CounterpartyRiskSignal } from "@crm/schemas";

export async function fetchKadArbitrSignals(
  _inns: string[],
  _now: string,
): Promise<{ signals: CounterpartyRiskSignal[]; status: "disabled" }> {
  return { signals: [], status: "disabled" };
}
