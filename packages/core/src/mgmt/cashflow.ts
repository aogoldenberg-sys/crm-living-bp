import type { BusinessEvent } from "@crm/schemas";
import type { CashFlowStatement, CashFlowRow } from "@crm/schemas";

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string } };

const CAPEX_RE = /капит|оборуд|актив|основн/i;
const FINANCING_RE = /займ|кредит|ссуд/i;

function monthKey(date: string): string {
  return date.slice(0, 8) + "01";
}

function inYear(date: string, year: number): boolean {
  return date.slice(0, 4) === String(year);
}

/**
 * Cash Flow косвенным методом.
 * operatingCf = payment_in − payment_out (все, кроме инвестиционных и финансовых).
 * investingCf = −payment_out с маркером капзатрат.
 * financingCf = payment_in с маркером займов − payment_out с тем же маркером.
 * endBalance накапливается нарастающим итогом с нуля.
 */
export function computeCashFlow(
  events: readonly BusinessEvent[],
  businessId: string,
  year: number,
  now: string,
): Result<CashFlowStatement> {
  const payments = events.filter(
    (e) => (e.type === "payment_in" || e.type === "payment_out") && inYear(e.valueDate, year),
  ) as Array<Extract<BusinessEvent, { type: "payment_in" | "payment_out" }>>;

  if (payments.length === 0) {
    return { ok: false, error: { code: "insufficient_data" } };
  }

  const byMonth = new Map<string, {
    allIn: number; allOut: number;
    capexOut: number;
    finIn: number; finOut: number;
  }>();

  for (const e of payments) {
    const key = monthKey(e.valueDate);
    if (!byMonth.has(key)) {
      byMonth.set(key, { allIn: 0, allOut: 0, capexOut: 0, finIn: 0, finOut: 0 });
    }
    const m = byMonth.get(key)!;
    if (e.type === "payment_in") {
      m.allIn += e.amount;
      if (FINANCING_RE.test(e.purpose)) m.finIn += e.amount;
    } else {
      m.allOut += e.amount;
      if (CAPEX_RE.test(e.purpose)) m.capexOut += e.amount;
      if (FINANCING_RE.test(e.purpose)) m.finOut += e.amount;
    }
  }

  const sorted = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  let runningBalance = 0;
  const rows: CashFlowRow[] = sorted.map(([month, m]) => {
    const investingCf = -m.capexOut;
    const financingCf = m.finIn - m.finOut;
    // operatingCf = всё движение минус инвестиционные и финансовые потоки
    const operatingCf = m.allIn - m.finIn - (m.allOut - m.capexOut - m.finOut);
    const netCf = operatingCf + investingCf + financingCf;
    runningBalance += netCf;
    return { month, operatingCf, investingCf, financingCf, netCf, endBalance: runningBalance };
  });

  return {
    ok: true,
    value: { businessId, year, rows, generatedAt: now, status: "draft" },
  };
}
