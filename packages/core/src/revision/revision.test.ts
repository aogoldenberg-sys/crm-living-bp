import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { BusinessEvent } from "@crm/schemas";
import type { UploadedSource } from "./index.js";
import {
  deriveAssumptions,
  computeHealthCheck,
  computeLayerCompleteness,
  checkConfidenceGate,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePaymentIn(
  overrides: Partial<Extract<BusinessEvent, { type: "payment_in" }>> = {},
): Extract<BusinessEvent, { type: "payment_in" }> {
  return {
    type: "payment_in",
    eventId: randomUUID(),
    ts: "2026-01-15T10:00:00Z",
    valueDate: "2026-01-15",
    amount: 100_000_00, // 100 000 руб in kopecks
    counterpartyInn: null,
    counterpartyName: "Contragent LLC",
    purpose: "Invoice payment",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "biz-1",
    ...overrides,
  };
}

function makePaymentOut(
  overrides: Partial<Extract<BusinessEvent, { type: "payment_out" }>> = {},
): Extract<BusinessEvent, { type: "payment_out" }> {
  return {
    type: "payment_out",
    eventId: randomUUID(),
    ts: "2026-01-20T10:00:00Z",
    valueDate: "2026-01-20",
    amount: 50_000_00,
    counterpartyInn: null,
    counterpartyName: "Supplier LLC",
    purpose: "Rent",
    expenseCategory: "rent",
    source: "manual",
    businessId: "biz-1",
    ...overrides,
  };
}

function makeSource(
  overrides: Partial<UploadedSource> = {},
): UploadedSource {
  return {
    sourceId: randomUUID(),
    kind: "bank_csv",
    fileRef: "some/file.csv",
    extractedAt: "2026-07-01T00:00:00Z",
    confidence: 0.95,
    ...overrides,
  };
}

// 6 months of synthetic events: jan-jun 2026
function makeSixMonthLog(): BusinessEvent[] {
  const months = [
    { month: "01", day: "15" },
    { month: "02", day: "14" },
    { month: "03", day: "15" },
    { month: "04", day: "15" },
    { month: "05", day: "15" },
    { month: "06", day: "15" },
  ];

  const events: BusinessEvent[] = [];

  for (const { month, day } of months) {
    const ts = `2026-${month}-${day}T10:00:00Z`;
    const valueDate = `2026-${month}-${day}` as `${number}-${number}-${number}`;

    // One payment_in per month
    events.push(
      makePaymentIn({
        ts,
        valueDate,
        amount: 200_000_00,
        counterpartyName: `Client ${month}`,
      }),
    );

    // One payment_out per month
    events.push(
      makePaymentOut({
        ts,
        valueDate: `2026-${month}-20` as `${number}-${number}-${number}`,
        amount: 80_000_00,
      }),
    );
  }

  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveAssumptions", () => {
  it("positiv: 6 мес истории — avg_check вычислен", () => {
    const events = makeSixMonthLog();
    const result = deriveAssumptions(events);

    expect(result.avg_check.value).not.toBeNull();
    if (result.avg_check.value !== null) {
      expect(result.avg_check.value).toBe(200_000_00);
      expect((result.avg_check as { value: number; sampleSize: number }).sampleSize).toBe(6);
    }
  });

  it("negativ: пустой лог — avg_check.value null", () => {
    const result = deriveAssumptions([]);

    expect(result.avg_check.value).toBeNull();
    expect((result.avg_check as { value: null; reason: string }).reason).toContain("insufficient_data");
  });

  it("negativ: один месяц данных (2 payment_in) — avg_check.value null", () => {
    const events: BusinessEvent[] = [
      makePaymentIn({ amount: 100_000_00 }),
      makePaymentIn({ amount: 150_000_00 }),
    ];
    const result = deriveAssumptions(events);

    expect(result.avg_check.value).toBeNull();
  });

  it("negativ: только payment_out — avg_check null", () => {
    const events: BusinessEvent[] = [
      makePaymentOut(),
      makePaymentOut(),
      makePaymentOut(),
    ];
    const result = deriveAssumptions(events);

    expect(result.avg_check.value).toBeNull();
  });
});

describe("computeHealthCheck", () => {
  it("positiv: 6 мес истории — runway_days > 0", () => {
    const events = makeSixMonthLog();
    const balance = 5_000_000_00; // 5 млн руб
    const result = computeHealthCheck(events, balance);

    expect(result.runway_days).not.toBeNull();
    expect(result.runway_days!).toBeGreaterThan(0);
    expect(result.burn_rate_kopecks).not.toBeNull();
    expect(result.burn_rate_kopecks!).toBeGreaterThan(0);
  });

  it("negativ: пустой лог — runway_days null", () => {
    const result = computeHealthCheck([], 1_000_000_00);

    expect(result.runway_days).toBeNull();
    expect(result.burn_rate_kopecks).toBeNull();
  });

  it("negativ: только расходы — concentration_risk null (нет выручки), avg_check null", () => {
    const events: BusinessEvent[] = [
      makePaymentOut({ amount: 50_000_00 }),
      makePaymentOut({ amount: 30_000_00 }),
    ];
    const hc = computeHealthCheck(events, 500_000_00);
    const assumptions = deriveAssumptions(events);

    expect(hc.concentration_risk).toBeNull();
    expect(assumptions.avg_check.value).toBeNull();
  });

  it("positiv: concentration >30% — red_flags содержит строку с 'concentration'", () => {
    // One counterparty dominates
    const events: BusinessEvent[] = [
      makePaymentIn({ amount: 900_000_00, counterpartyName: "BigCorp" }),
      makePaymentIn({ amount: 50_000_00, counterpartyName: "SmallCo" }),
      makePaymentIn({ amount: 50_000_00, counterpartyName: "TinyCo" }),
    ];
    const result = computeHealthCheck(events, 1_000_000_00);

    expect(result.red_flags.length).toBeGreaterThan(0);
    expect(result.red_flags.some((f) => f.includes("concentration"))).toBe(true);
    expect(result.concentration_risk).not.toBeNull();
    expect(result.concentration_risk!).toBeGreaterThan(0.3);
  });
});

describe("computeLayerCompleteness + checkConfidenceGate", () => {
  it("positiv: все слои покрыты — verdict 'ok'", () => {
    const sources: UploadedSource[] = [
      makeSource({ kind: "bank_csv", confidence: 0.95 }),
      makeSource({ kind: "crm_export", confidence: 0.92 }),
      makeSource({ kind: "contract", confidence: 0.91 }),
      makeSource({ kind: "voice", confidence: 0.93 }),
    ];
    const completeness = computeLayerCompleteness(sources);
    const gate = checkConfidenceGate(completeness);

    expect(gate.verdict).toBe("ok");
  });

  it("negativ: нет bank источников — verdict 'insufficient_data', missing содержит 'bank_statement'", () => {
    const sources: UploadedSource[] = [
      makeSource({ kind: "crm_export", confidence: 0.95 }),
      makeSource({ kind: "contract", confidence: 0.95 }),
      makeSource({ kind: "voice", confidence: 0.95 }),
      // no bank_csv or bank_pdf
    ];
    const completeness = computeLayerCompleteness(sources);
    const gate = checkConfidenceGate(completeness);

    expect(gate.verdict).toBe("insufficient_data");
    if (gate.verdict === "insufficient_data") {
      expect(gate.missing).toContain("bank_statement");
    }
  });
});
