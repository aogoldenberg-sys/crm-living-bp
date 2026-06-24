import { describe, it, expect } from "vitest";
import { computeUnitEconomics } from "./compute.js";
import { DEFAULT_THRESHOLDS } from "./types.js";
import type { BusinessEvent } from "@crm/schemas";

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;
function uuid(): string {
  return `00000000-0000-0000-0000-${String(++_seq).padStart(12, "0")}`;
}

function makePaymentIn(amount: number, ts: string): BusinessEvent {
  return {
    type: "payment_in",
    eventId: uuid(),
    ts,
    valueDate: ts.slice(0, 10),
    amount,
    counterpartyInn: null,
    counterpartyName: "Client A",
    purpose: "Оплата услуг",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "test-biz",
  };
}

function makePaymentOut(amount: number, expenseCategory: string, ts: string): BusinessEvent {
  return {
    type: "payment_out",
    eventId: uuid(),
    ts,
    valueDate: ts.slice(0, 10),
    amount,
    counterpartyInn: null,
    counterpartyName: "Supplier",
    purpose: "Расход",
    expenseCategory,
    source: "manual",
    businessId: "test-biz",
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("computeUnitEconomics", () => {
  it("positive case: 15 events — computes margin, ROI correctly", () => {
    // Revenue: 10 payments of 100_000 kopecks = 1_000_000 total
    // COGS: 2 payments of 150_000 kopecks = 300_000
    // Other costs: 3 payments of 100_000 kopecks = 300_000
    // Total costs: 600_000, margin = 700_000, marginPercent = 0.7, ROI = (1M - 600k) / 600k ≈ 0.667
    const events: BusinessEvent[] = [
      makePaymentIn(100_000, "2024-01-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-01-15T10:00:00Z"),
      makePaymentIn(100_000, "2024-02-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-02-15T10:00:00Z"),
      makePaymentIn(100_000, "2024-03-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-03-15T10:00:00Z"),
      makePaymentIn(100_000, "2024-04-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-04-15T10:00:00Z"),
      makePaymentIn(100_000, "2024-05-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-05-15T10:00:00Z"),
      makePaymentOut(150_000, "COGS", "2024-01-10T10:00:00Z"),
      makePaymentOut(150_000, "себестоимость", "2024-03-10T10:00:00Z"),
      makePaymentOut(100_000, "marketing", "2024-02-10T10:00:00Z"),
      makePaymentOut(100_000, "ads", "2024-04-10T10:00:00Z"),
      makePaymentOut(100_000, "operations", "2024-05-10T10:00:00Z"),
    ];

    const result = computeUnitEconomics({ events, newClients: 5 });

    expect(result.health).not.toBe("insufficient_data");
    expect(result.marginKopecks).toBe(700_000); // 1_000_000 - 300_000
    expect(result.marginPercent).toBeCloseTo(0.7, 5);
    // totalCosts = 600_000, roi = (1_000_000 - 600_000) / 600_000 ≈ 0.6667
    expect(result.roi).toBeCloseTo(400_000 / 600_000, 5);
    // CAC = (100_000 + 100_000) / 5 = 40_000
    expect(result.cacKopecks).toBe(40_000);
    expect(result.dataWindowMonths).toBeGreaterThan(0);
  });

  it("edge: 5 events → health = insufficient_data", () => {
    const events: BusinessEvent[] = [
      makePaymentIn(100_000, "2024-01-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-02-01T10:00:00Z"),
      makePaymentOut(50_000, "marketing", "2024-01-15T10:00:00Z"),
      makePaymentOut(50_000, "COGS", "2024-02-15T10:00:00Z"),
      makePaymentIn(100_000, "2024-03-01T10:00:00Z"),
    ];

    const result = computeUnitEconomics({ events, newClients: 2 });
    expect(result.health).toBe("insufficient_data");
    expect(result.marginKopecks).toBe(0);
    expect(result.cacKopecks).toBeNull();
    expect(result.ltvKopecks).toBeNull();
  });

  it("edge: negative margin → health = critical", () => {
    // Revenue total = 50_000 (5×10_000), COGS = 200_000 → margin negative
    const events: BusinessEvent[] = [
      makePaymentIn(10_000, "2024-01-01T10:00:00Z"),
      makePaymentIn(10_000, "2024-01-05T10:00:00Z"),
      makePaymentIn(10_000, "2024-01-10T10:00:00Z"),
      makePaymentIn(10_000, "2024-01-15T10:00:00Z"),
      makePaymentIn(10_000, "2024-01-20T10:00:00Z"),
      makePaymentOut(200_000, "COGS", "2024-01-02T10:00:00Z"),
      makePaymentOut(5_000, "marketing", "2024-01-03T10:00:00Z"),
      makePaymentOut(5_000, "ads", "2024-01-04T10:00:00Z"),
      makePaymentOut(5_000, "operations", "2024-01-06T10:00:00Z"),
      makePaymentOut(5_000, "operations", "2024-01-07T10:00:00Z"),
      makePaymentOut(5_000, "operations", "2024-01-08T10:00:00Z"),
    ];

    const result = computeUnitEconomics({ events, newClients: 3 });
    // marginKopecks = 50_000 - 200_000 = -150_000 < 0 → critical
    expect(result.health).toBe("critical");
    expect(result.marginKopecks).toBeLessThan(0);
  });

  it("edge: newClients=0 → cacKopecks=null, ltvKopecks=null", () => {
    const events: BusinessEvent[] = [
      makePaymentIn(100_000, "2024-01-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-02-01T10:00:00Z"),
      makePaymentIn(100_000, "2024-03-01T10:00:00Z"),
      makePaymentOut(50_000, "marketing", "2024-01-15T10:00:00Z"),
      makePaymentOut(50_000, "COGS", "2024-02-15T10:00:00Z"),
      makePaymentOut(30_000, "ads", "2024-03-01T10:00:00Z"),
      makePaymentIn(80_000, "2024-03-10T10:00:00Z"),
      makePaymentOut(20_000, "operations", "2024-03-12T10:00:00Z"),
      makePaymentIn(70_000, "2024-03-20T10:00:00Z"),
      makePaymentOut(10_000, "operations", "2024-03-25T10:00:00Z"),
      makePaymentIn(60_000, "2024-03-28T10:00:00Z"),
    ];

    const result = computeUnitEconomics({ events, newClients: 0 });
    expect(result.health).not.toBe("insufficient_data");
    expect(result.cacKopecks).toBeNull();
    expect(result.ltvKopecks).toBeNull();
    expect(result.ltvCacRatio).toBeNull();
  });

  it("edge: empty events → health = insufficient_data", () => {
    const result = computeUnitEconomics({ events: [], newClients: 0 });
    expect(result.health).toBe("insufficient_data");
    expect(result.marginKopecks).toBe(0);
    expect(result.roi).toBe(0);
    expect(result.paybackMonths).toBeNull();
    expect(result.cacKopecks).toBeNull();
    expect(result.ltvKopecks).toBeNull();
    expect(result.ltvCacRatio).toBeNull();
    expect(result.dataWindowMonths).toBe(0);
  });

  it("custom thresholds: healthy when all metrics above thresholds", () => {
    // Revenue 1_000_000, COGS 200_000 → margin 80%, ROI high
    const events: BusinessEvent[] = [
      makePaymentIn(200_000, "2024-01-01T10:00:00Z"),
      makePaymentIn(200_000, "2024-02-01T10:00:00Z"),
      makePaymentIn(200_000, "2024-03-01T10:00:00Z"),
      makePaymentIn(200_000, "2024-04-01T10:00:00Z"),
      makePaymentIn(200_000, "2024-05-01T10:00:00Z"),
      makePaymentOut(50_000, "COGS", "2024-01-15T10:00:00Z"),
      makePaymentOut(50_000, "COGS", "2024-02-15T10:00:00Z"),
      makePaymentOut(50_000, "COGS", "2024-03-15T10:00:00Z"),
      makePaymentOut(50_000, "COGS", "2024-04-15T10:00:00Z"),
      makePaymentOut(10_000, "marketing", "2024-01-20T10:00:00Z"),
      makePaymentOut(10_000, "marketing", "2024-02-20T10:00:00Z"),
    ];

    const result = computeUnitEconomics({ events, newClients: 5 }, {
      ...DEFAULT_THRESHOLDS,
      ltvCacWarn: 3.0,
    });

    // marginPercent = (1_000_000 - 200_000) / 1_000_000 = 0.8 > 0.2 ✓
    expect(result.marginPercent).toBeCloseTo(0.8, 5);
    // totalCosts = 220_000, roi = (1_000_000 - 220_000) / 220_000 ≈ 3.5 > 1.0 ✓
    expect(result.roi).toBeGreaterThan(1.0);
    // LTV/CAC should be high given large revenue per client vs low marketing spend
    expect(result.ltvCacRatio).not.toBeNull();
    expect(result.health).toBe("healthy");
  });
});
