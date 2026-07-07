import type { BusinessEvent } from "@crm/schemas";

export type MonthlySale = {
  month: string;      // "2026-01-01"
  revenueKopecks: number;
  txCount: number;
};

function monthKey(date: string): string {
  return date.slice(0, 8) + "01";
}

const REVENUE_RE = /выручка|оплата|поступление|продажа|аванс/i;

export function salesFromLedger(events: readonly BusinessEvent[]): MonthlySale[] {
  const byMonth = new Map<string, { revenue: number; count: number }>();

  for (const e of events) {
    if (e.type !== "payment_in") continue;

    const lp = (e.purpose ?? "").toLowerCase();
    // Займы и кредиты явно исключаем
    if (lp.includes("займ") || lp.includes("кредит") || lp.includes("возврат займа")) continue;

    // Если назначение есть но не похоже на выручку — пропускаем только если явный признак не-выручки
    // Пустое назначение или выручка — берём
    if (e.purpose && !REVENUE_RE.test(e.purpose)) {
      // не пустое и не выручка — всё равно считаем (осторожный default для неразмеченных платежей)
    }

    const key = monthKey(e.valueDate);
    const cur = byMonth.get(key) ?? { revenue: 0, count: 0 };
    cur.revenue += e.amount;
    cur.count += 1;
    byMonth.set(key, cur);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { revenue, count }]) => ({
      month,
      revenueKopecks: revenue,
      txCount: count,
    }));
}
