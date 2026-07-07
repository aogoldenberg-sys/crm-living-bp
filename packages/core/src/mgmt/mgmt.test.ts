import { describe, it, expect } from "vitest";
import { computePnL } from "./pnl.js";
import { computeCashFlow } from "./cashflow.js";
import { computeMgmtBalance } from "./balance.js";
import type { BusinessEvent } from "@crm/schemas";

const NOW = "2026-07-01T00:00:00Z";
const BID = "biz-001";

function mkIn(id: string, date: string, amount: number, purpose = "оплата услуг"): BusinessEvent {
  return {
    type: "payment_in",
    eventId: id,
    ts: NOW,
    valueDate: date,
    amount,
    counterpartyInn: null,
    counterpartyName: "Клиент",
    purpose,
    matchedInvoiceId: null,
    source: "manual",
    businessId: BID,
  };
}

function mkOut(id: string, date: string, amount: number, purpose = "аренда офиса"): BusinessEvent {
  return {
    type: "payment_out",
    eventId: id,
    ts: NOW,
    valueDate: date,
    amount,
    counterpartyInn: null,
    counterpartyName: "Поставщик",
    purpose,
    expenseCategory: "opex",
    source: "manual",
    businessId: BID,
  };
}

const EVENTS: BusinessEvent[] = [
  // Январь: выручка 100_000, cogs 30_000, opex 10_000
  mkIn("1", "2026-01-15", 100_000_00, "оплата"),
  mkOut("2", "2026-01-20", 30_000_00, "закупка товаров"),
  mkOut("3", "2026-01-25", 10_000_00, "аренда"),
  // Февраль: выручка 80_000, opex 20_000
  mkIn("4", "2026-02-10", 80_000_00, "оплата"),
  mkOut("5", "2026-02-15", 20_000_00, "зарплата"),
  // Март: выручка 120_000, cogs 50_000, opex 15_000
  mkIn("6", "2026-03-05", 120_000_00, "выручка"),
  mkOut("7", "2026-03-10", 50_000_00, "материалы для производства"),
  mkOut("8", "2026-03-20", 15_000_00, "маркетинг"),
];

describe("computePnL", () => {
  it("возвращает PnLStatement с 3 строками за 3 месяца", () => {
    const result = computePnL(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(3);
    expect(result.value.businessId).toBe(BID);
    expect(result.value.year).toBe(2026);
    expect(result.value.status).toBe("draft");
  });

  it("totalRevenue = сумма всех payment_in за год", () => {
    const result = computePnL(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100_000_00 + 80_000_00 + 120_000_00 = 300_000_00
    expect(result.value.totalRevenue).toBe(300_000_00);
  });

  it("totalNetProfit = revenue − cogs − opex (нет tax/interest)", () => {
    const result = computePnL(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (300_000 − 80_000 − 45_000) * 100 копеек
    expect(result.value.totalNetProfit).toBe(175_000_00);
  });

  it("нет событий за год → insufficient_data", () => {
    const result = computePnL(EVENTS, BID, 2025, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("пустой массив событий → insufficient_data", () => {
    const result = computePnL([], BID, 2026, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("cogs отделяется от opex по назначению", () => {
    const result = computePnL(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Январь: cogs = 30_000_00 (закупка), opex = 10_000_00 (аренда)
    const jan = result.value.rows.find((r) => r.month === "2026-01-01");
    expect(jan).toBeDefined();
    expect(jan!.cogs).toBe(30_000_00);
    expect(jan!.opex).toBe(10_000_00);
    expect(jan!.grossProfit).toBe(70_000_00); // 100_000 − 30_000
  });

  it("ebt = ebitda (interest = 0)", () => {
    const result = computePnL(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const row of result.value.rows) {
      expect(row.interest).toBe(0);
      expect(row.ebt).toBe(row.ebitda);
    }
  });

  it("строки отсортированы по месяцу", () => {
    const result = computePnL(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const months = result.value.rows.map((r) => r.month);
    expect(months).toEqual([...months].sort());
  });
});

describe("computeCashFlow", () => {
  it("endBalance накапливается нарастающим итогом", () => {
    const result = computeCashFlow(EVENTS, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.value.rows;
    expect(rows.length).toBeGreaterThan(0);
    // endBalance[i] = endBalance[i-1] + netCf[i]
    let running = 0;
    for (const r of rows) {
      running += r.netCf;
      expect(r.endBalance).toBe(running);
    }
  });

  it("нет событий → insufficient_data", () => {
    const result = computeCashFlow([], BID, 2026, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("капзатраты попадают в investingCf отрицательным", () => {
    const withCapex: BusinessEvent[] = [
      mkIn("i1", "2026-04-01", 100_000_00),
      mkOut("i2", "2026-04-05", 50_000_00, "закупка оборудования"),
    ];
    const result = computeCashFlow(withCapex, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const apr = result.value.rows[0]!;
    expect(apr.investingCf).toBe(-50_000_00);
  });

  it("займы попадают в financingCf", () => {
    const withLoan: BusinessEvent[] = [
      mkIn("l1", "2026-05-01", 200_000_00, "получен займ от учредителя"),
      mkOut("l2", "2026-05-15", 10_000_00, "погашение кредита"),
    ];
    const result = computeCashFlow(withLoan, BID, 2026, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const may = result.value.rows[0]!;
    expect(may.financingCf).toBe(200_000_00 - 10_000_00);
  });
});

// Синтетические данные 12 месяцев 2026
const MONTHLY_IN  = [90, 110, 85, 120, 95, 130, 100, 75, 140, 105, 115, 160].map((v) => v * 1_000_00);
const MONTHLY_OUT = [40,  50, 35,  60, 45,  55,  50, 30,  70,  45,  55,  80].map((v) => v * 1_000_00);

const MONTHS_2026 = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
];

function mk12Events(): BusinessEvent[] {
  const evts: BusinessEvent[] = [];
  for (let i = 0; i < 12; i++) {
    evts.push(mkIn(`y${i}i`, `${MONTHS_2026[i]}-10`, MONTHLY_IN[i]!));
    evts.push(mkOut(`y${i}o`, `${MONTHS_2026[i]}-20`, MONTHLY_OUT[i]!));
  }
  return evts;
}

describe("computeMgmtBalance — 12 месяцев синтетики", () => {
  const events = mk12Events();
  const totalIn  = MONTHLY_IN.reduce((s, v) => s + v, 0);
  const totalOut = MONTHLY_OUT.reduce((s, v) => s + v, 0);

  it("cash = сумма всех payment_in − payment_out", () => {
    const bal = computeMgmtBalance(events, NOW);
    expect(bal.cash).toBe(totalIn - totalOut);
  });

  it("ar = 0 (нет invoice_issued в схеме)", () => {
    const bal = computeMgmtBalance(events, NOW);
    expect(bal.ar).toBe(0);
  });

  it("ap = 0 (нет события кредиторки)", () => {
    const bal = computeMgmtBalance(events, NOW);
    expect(bal.ap).toBe(0);
  });

  it("equity = cash + ar - ap", () => {
    const bal = computeMgmtBalance(events, NOW);
    expect(bal.equity).toBe(bal.cash + bal.ar - bal.ap);
  });

  it("asOf передаётся без изменений", () => {
    const bal = computeMgmtBalance(events, NOW);
    expect(bal.asOf).toBe(NOW);
  });

  it("пустой массив → cash = 0, equity = 0", () => {
    const bal = computeMgmtBalance([], NOW);
    expect(bal.cash).toBe(0);
    expect(bal.equity).toBe(0);
  });

  it("только payment_in → cash положительный", () => {
    const onlyIn = events.filter((e) => e.type === "payment_in");
    const bal = computeMgmtBalance(onlyIn, NOW);
    expect(bal.cash).toBe(totalIn);
    expect(bal.cash).toBeGreaterThan(0);
  });

  it("только payment_out → cash отрицательный", () => {
    const onlyOut = events.filter((e) => e.type === "payment_out");
    const bal = computeMgmtBalance(onlyOut, NOW);
    expect(bal.cash).toBe(-totalOut);
    expect(bal.cash).toBeLessThan(0);
  });
});
