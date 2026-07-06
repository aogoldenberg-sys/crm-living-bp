import { describe, it, expect } from "vitest";
import { computeUsn6, computeUsn15, computeContribs, computeKudir, detectGaps } from "./usn.js";
import type { BusinessEvent, TaxProfile, TaxPeriod } from "@crm/schemas";

const NOW = "2026-01-31T12:00:00.000Z";
const makeId = () => "00000000-0000-0000-0000-000000000001";

function makeIn(eventId: string, date: string, amount: number): BusinessEvent {
  return {
    type: "payment_in",
    eventId,
    ts: date + "T00:00:00.000Z",
    valueDate: date,
    amount,
    purpose: "оплата по договору",
    counterpartyInn: "7701234567",
    matchedInvoiceId: null,
    source: "bank_api",
  } as unknown as BusinessEvent;
}

function makeOut(eventId: string, date: string, amount: number, purpose = "аренда"): BusinessEvent {
  return {
    type: "payment_out",
    eventId,
    ts: date + "T00:00:00.000Z",
    valueDate: date,
    amount,
    purpose,
    counterpartyInn: "7701234568",
    matchedInvoiceId: null,
    source: "bank_api",
  } as unknown as BusinessEvent;
}

const profileUsn6: TaxProfile = {
  inn: "770100000001",
  kpp: null,
  legalForm: "ip",
  regime: "usn6",
  regimeConfirmedByOwner: true,
  oktmo: "45000000",
  taxRatePct: 6,
  employees: false,
};

const profileUsn15: TaxProfile = {
  ...profileUsn6,
  regime: "usn15",
  taxRatePct: 15,
};

const events6 = [
  makeIn("e1", "2026-01-15", 100000_00),  // Q1: 100 000 ₽
  makeIn("e2", "2026-04-10", 200000_00),  // Q2: 200 000 ₽
];

const events15 = [
  makeIn("e1", "2026-01-15", 500000_00),
  makeIn("e2", "2026-07-01", 100000_00),
  makeOut("e3", "2026-02-01", 200000_00),
  makeOut("e4", "2026-08-01",  50000_00),
];

describe("computeUsn6", () => {
  it("считает налог по двум кварталам", () => {
    const r = computeUsn6(events6, profileUsn6, 2026, makeId, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(v.regime).toBe("usn6");
    // нарастающим: Q1=100k, Q2=300k
    expect(v.incomeByQuarter[0]).toBe(100000_00);
    expect(v.incomeByQuarter[1]).toBe(300000_00);
    expect(v.incomeByQuarter[2]).toBe(300000_00);
    expect(v.incomeByQuarter[3]).toBe(300000_00);
    expect(v.taxToPay).toBeGreaterThan(0);
    expect(v.status).toBe("draft");
    expect(v.minTax).toBeNull();
  });

  it("возвращает insufficient_data без поступлений", () => {
    const r = computeUsn6([], profileUsn6, 2026, makeId, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("insufficient_data");
  });

  it("wrong_regime если profile не usn6", () => {
    const r = computeUsn6(events6, profileUsn15, 2026, makeId, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("wrong_regime");
  });
});

describe("computeUsn15", () => {
  it("считает налог (доход−расход)×ставка", () => {
    const r = computeUsn15(events15, profileUsn15, 2026, makeId, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(v.regime).toBe("usn15");
    expect(v.expenseByQuarter).not.toBeNull();
    // Q1 доход=500k расход=200k, налог=(500k-200k)*15%=45k₽=4500000 коп
    expect(v.taxByQuarter[0]).toBe(4500000);
    expect(v.minTax).toBeGreaterThan(0);
    expect(v.status).toBe("draft");
  });

  it("применяет минимальный налог когда расходы > доходов", () => {
    const biasedEvents = [
      makeIn("e1", "2026-01-15", 100_00),       // доход 100 ₽
      makeOut("e2", "2026-01-20", 100000_00),    // расход 1000 ₽
    ];
    const r = computeUsn15(biasedEvents, profileUsn15, 2026, makeId, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // минимальный налог = 1% от 100 коп = 1 коп (целое)
    expect(r.value.taxToPay).toBe(r.value.minTax);
    expect(r.value.warnings.some(w => w.includes("минимальный налог"))).toBe(true);
  });

  it("insufficient_data без событий", () => {
    const r = computeUsn15([], profileUsn15, 2026, makeId, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("insufficient_data");
  });

  it("wrong_regime если profile не usn15", () => {
    const r = computeUsn15(events15, profileUsn6, 2026, makeId, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("wrong_regime");
  });
});

describe("computeContribs", () => {
  it("фикс если доход ниже порога", () => {
    const c = computeContribs(events6, 2026);
    expect(c.overThresholdAmount).toBe(0);
    expect(c.total).toBe(5784200);
  });

  it("1% сверх порога 300k", () => {
    const bigEvents = [makeIn("e1", "2026-01-15", 50000000_00)]; // 50 млн
    const c = computeContribs(bigEvents, 2026);
    expect(c.overThresholdAmount).toBeGreaterThan(0);
    expect(c.total).toBeGreaterThan(5784200);
  });
});

describe("computeKudir", () => {
  it("строит КУДиР из событий", () => {
    const period: TaxPeriod = { year: 2026, quarter: null };
    const r = computeKudir(events6, profileUsn6, period, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows.length).toBe(2);
    expect(r.value.totalIncome).toBe(300000_00);
    expect(r.value.status).toBe("draft");
  });
});

describe("detectGaps", () => {
  it("нет разрывов при непрерывных данных", () => {
    const e = [
      makeIn("e1", "2026-01-10", 1_00),
      makeIn("e2", "2026-02-10", 1_00),
      makeIn("e3", "2026-03-10", 1_00),
    ];
    expect(detectGaps(e, 2026)).toEqual([]);
  });

  it("обнаруживает пропущенный месяц", () => {
    const e = [
      makeIn("e1", "2026-01-10", 1_00),
      makeIn("e2", "2026-03-10", 1_00),
    ];
    const gaps = detectGaps(e, 2026);
    expect(gaps.some(g => g.includes("2"))).toBe(true);
  });
});
