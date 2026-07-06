import type { BusinessEvent } from "@crm/schemas";
import type { PnLStatement, PnLRow } from "@crm/schemas";

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string } };

// Назначения платежей, классифицирующие payment_out как себестоимость
const COGS_RE = /себестоим|матер|товар|закуп/i;
// Капитальные затраты — не операционные и не себестоимость
const CAPEX_RE = /капит|оборуд|актив|основн/i;

function monthKey(date: string): string {
  // "2026-03-15" → "2026-03-01"
  return date.slice(0, 8) + "01";
}

function inYear(date: string, year: number): boolean {
  return date.slice(0, 4) === String(year);
}

/**
 * P&L из событий лога. Кассовый метод — по valueDate.
 * ebt = ebitda (нет данных по процентам).
 * tax = 0 (см. tax/usn).
 */
export function computePnL(
  events: readonly BusinessEvent[],
  businessId: string,
  year: number,
  now: string,
): Result<PnLStatement> {
  const payments = events.filter(
    (e) => (e.type === "payment_in" || e.type === "payment_out") && inYear(e.valueDate, year),
  ) as Array<Extract<BusinessEvent, { type: "payment_in" | "payment_out" }>>;

  if (payments.length === 0) {
    return { ok: false, error: { code: "insufficient_data" } };
  }

  // Агрегация по месяцам
  const byMonth = new Map<string, { revenue: number; cogs: number; opex: number }>();
  for (const e of payments) {
    const key = monthKey(e.valueDate);
    if (!byMonth.has(key)) byMonth.set(key, { revenue: 0, cogs: 0, opex: 0 });
    const m = byMonth.get(key)!;
    if (e.type === "payment_in") {
      m.revenue += e.amount;
    } else {
      if (COGS_RE.test(e.purpose) && !CAPEX_RE.test(e.purpose)) {
        m.cogs += e.amount;
      } else {
        m.opex += e.amount;
      }
    }
  }

  const rows: PnLRow[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => {
      const grossProfit = m.revenue - m.cogs;
      const ebitda = grossProfit - m.opex;
      const ebt = ebitda; // interest = 0
      const netProfit = ebt; // tax = 0
      return {
        month,
        revenue: m.revenue,
        cogs: m.cogs,
        grossProfit,
        opex: m.opex,
        ebitda,
        interest: 0,
        ebt,
        tax: 0,
        netProfit,
      };
    });

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalNetProfit = rows.reduce((s, r) => s + r.netProfit, 0);

  return {
    ok: true,
    value: {
      businessId,
      year,
      rows,
      totalRevenue,
      totalNetProfit,
      generatedAt: now,
      status: "draft",
    },
  };
}
