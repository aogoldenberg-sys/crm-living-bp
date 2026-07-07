import type { BusinessEvent } from "@crm/schemas";

export type AccountingCard = {
  period: string;    // "2025-01" — ISO YYYY-MM
  revenue: number;   // в копейках
  expenses: number;  // в копейках
  profit: number;    // revenue - expenses
  eventCount: number;
};

/**
 * Группирует payment_in/payment_out по YYYY-MM и строит карточки.
 * Остальные типы событий (deal, lead, call, etc.) игнорируются —
 * карточка отражает только движение денег.
 */
export function buildAccountingCards(events: BusinessEvent[]): AccountingCard[] {
  const map = new Map<string, { revenue: number; expenses: number; eventCount: number }>();

  for (const e of events) {
    if (e.type !== "payment_in" && e.type !== "payment_out") continue;
    const period = e.valueDate.slice(0, 7); // "YYYY-MM"
    let row = map.get(period);
    if (!row) {
      row = { revenue: 0, expenses: 0, eventCount: 0 };
      map.set(period, row);
    }
    if (e.type === "payment_in") row.revenue += e.amount;
    else row.expenses += e.amount;
    row.eventCount++;
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([period, { revenue, expenses, eventCount }]) => ({
      period,
      revenue,
      expenses,
      profit: revenue - expenses,
      eventCount,
    }));
}
