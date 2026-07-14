/**
 * Tests for GET /unit-economics endpoint logic.
 * We test computeUnitEconomics directly (same logic the endpoint uses)
 * with a mocked adapter result, matching what handleUnitEconomics does.
 */
import { describe, it, expect } from "vitest";
import { computeUnitEconomics, DEFAULT_THRESHOLDS } from "@crm/core";
import type { BusinessEvent } from "@crm/schemas";

const BASE_EVENT = {
  eventId: "550e8400-e29b-41d4-a716-446655440001",
  businessId: "test-biz",
  source: "manual" as const,
} as const;

/** Builds a minimal PaymentIn event. */
function paymentIn(ts: string, amount: number, idx: number): BusinessEvent {
  return {
    type: "payment_in",
    eventId: `550e8400-e29b-41d4-a716-44665544${String(idx).padStart(4, "0")}`,
    ts,
    valueDate: ts.slice(0, 10),
    amount,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Тест",
    matchedInvoiceId: null,
    source: "manual",
    businessId: BASE_EVENT.businessId,
  };
}

/** Builds a minimal PaymentOut event (non-COGS category so margin stays high). */
function paymentOut(ts: string, amount: number, idx: number): BusinessEvent {
  return {
    type: "payment_out",
    eventId: `550e8400-e29b-41d4-a716-55775577${String(idx).padStart(4, "0")}`,
    ts,
    valueDate: ts.slice(0, 10),
    amount,
    counterpartyInn: null,
    counterpartyName: "Поставщик",
    purpose: "Аренда",
    expenseCategory: "rent",   // not COGS → doesn't reduce margin
    matchedInvoiceId: null,
    source: "manual",
    businessId: BASE_EVENT.businessId,
  };
}

describe("GET /unit-economics endpoint logic", () => {
  it("fewer than 10 events → health=insufficient_data", () => {
    const events: BusinessEvent[] = [
      paymentIn("2026-01-10T10:00:00Z", 100_000, 1),
      paymentIn("2026-01-15T10:00:00Z", 200_000, 2),
    ];

    const result = computeUnitEconomics({ events, newClients: 0 }, DEFAULT_THRESHOLDS);

    expect(result.health).toBe("insufficient_data");
    expect(result.cacKopecks).toBeNull();
    expect(result.ltvKopecks).toBeNull();
    expect(result.ltvCacRatio).toBeNull();
  });

  it("10+ events with margin > 20% and ROI > 1 → health=healthy", () => {
    // 8 revenue events (800k total), 2 cost events (100k total)
    // ROI = (800k - 100k) / 100k = 7.0 > 1.0
    // margin = (800k - 0 COGS) / 800k = 100% > 20%  [rent is not COGS]
    const revenue: BusinessEvent[] = Array.from({ length: 8 }, (_, i) =>
      paymentIn(`2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`, 100_000, i + 10)
    );
    const costs: BusinessEvent[] = [
      paymentOut("2026-01-05T12:00:00Z", 50_000, 1),
      paymentOut("2026-01-20T12:00:00Z", 50_000, 2),
    ];
    const events: BusinessEvent[] = [...revenue, ...costs];

    const result = computeUnitEconomics({ events, newClients: 0 }, DEFAULT_THRESHOLDS);

    expect(result.health).toBe("healthy");
    expect(result.marginPercent).toBeGreaterThan(0.20);
    expect(result.roi).toBeGreaterThan(1.0);
    expect(result.marginKopecks).toBeGreaterThan(0);
  });
});
