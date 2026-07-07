import type { BusinessEvent } from "@crm/schemas";

// cash = sum(payment_in) - sum(payment_out) across all events
// ar = 0 (invoice_issued не существует в текущей схеме)
// ap = 0 (нет события кредиторки)
// equity = cash + ar - ap
export function computeMgmtBalance(
  events: readonly BusinessEvent[],
  asOf: string,
): { cash: number; ar: number; ap: number; equity: number; asOf: string } {
  let cash = 0;
  for (const e of events) {
    if (e.type === "payment_in") cash += e.amount;
    else if (e.type === "payment_out") cash -= e.amount;
  }
  const ar = 0;
  const ap = 0;
  return { cash, ar, ap, equity: cash + ar - ap, asOf };
}
