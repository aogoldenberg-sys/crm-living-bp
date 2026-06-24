import { describe, it, expect } from "vitest";
import { computeAbcXyz } from "./abcxyz.js";
import type { BusinessEvent } from "@crm/schemas";

// ── Test helpers ──────────────────────────────────────────────────────────────

let _seq = 0;
function uuid(): string {
  return `00000000-0000-0000-0000-${String(++_seq).padStart(12, "0")}`;
}

/**
 * Create a PaymentIn event with counterpartyInn as the client identifier.
 * All money is int kopecks.
 */
function makePaymentIn(
  counterpartyInn: string,
  amountKopecks: number,
  yearMonth: string, // "YYYY-MM"
): BusinessEvent {
  return {
    type: "payment_in",
    eventId: uuid(),
    ts: `${yearMonth}-15T10:00:00Z`,
    valueDate: `${yearMonth}-15`,
    amount: amountKopecks,
    counterpartyInn,
    counterpartyName: `Client ${counterpartyInn}`,
    purpose: "payment",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "tenants/demo",
  } satisfies BusinessEvent;
}

// ── Fixtures: 3 clients × 12 months ──────────────────────────────────────────
// Client A: dominant, 70% of revenue — large stable payments
// Client B: medium, 20% of revenue
// Client C: small, 10% of revenue

const CLIENT_A = "7700000001";
const CLIENT_B = "7700000002";
const CLIENT_C = "7700000003";

const MONTHS_12 = [
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
];

// Client A: 700_000_00 per month (stable)
// Client B: 200_000_00 per month (stable)
// Client C: 100_000_00 per month (stable)
// Total per month: 1_000_000_00 kopecks

const events12: BusinessEvent[] = MONTHS_12.flatMap((month) => [
  makePaymentIn(CLIENT_A, 700_000_00, month),
  makePaymentIn(CLIENT_B, 200_000_00, month),
  makePaymentIn(CLIENT_C, 100_000_00, month),
]);

// ── ABC/XYZ: 3 clients 12 months ─────────────────────────────────────────────

describe("computeAbcXyz — 3 clients, 12 months, stable payments", () => {
  const result = computeAbcXyz({
    events: events12,
    groupBy: "client",
    windowMonths: 12,
  });

  it("returns non-null result", () => {
    expect(result).not.toBeNull();
  });

  it("returns exactly 3 entries", () => {
    expect(result!.entries).toHaveLength(3);
  });

  it("Client A classified as A (≥70% of revenue)", () => {
    const entry = result!.entries.find((e) => e.entityId === CLIENT_A);
    expect(entry?.abcClass).toBe("A");
  });

  it("Client B classified as B (cumulative 70-90%)", () => {
    const entry = result!.entries.find((e) => e.entityId === CLIENT_B);
    expect(entry?.abcClass).toBe("B");
  });

  it("Client C classified as C (tail)", () => {
    const entry = result!.entries.find((e) => e.entityId === CLIENT_C);
    expect(entry?.abcClass).toBe("C");
  });

  it("all clients with stable monthly payments are X (CV ≤ 0.25)", () => {
    for (const entry of result!.entries) {
      expect(entry.xyzClass).toBe("X");
    }
  });

  it("entries sorted by totalRevenue descending", () => {
    const revenues = result!.entries.map((e) => e.totalRevenueKopecks);
    const sorted = [...revenues].sort((a, b) => b - a);
    expect(revenues).toEqual(sorted);
  });

  it("revenueShare sums to approximately 1.0", () => {
    const total = result!.entries.reduce((s, e) => s + e.revenueShare, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("AX count = 1, BX = 1, CX = 1", () => {
    expect(result!.counts["AX"]).toBe(1);
    expect(result!.counts["BX"]).toBe(1);
    expect(result!.counts["CX"]).toBe(1);
  });

  it("monthlyRevenues length = windowMonths", () => {
    for (const entry of result!.entries) {
      expect(entry.monthlyRevenues).toHaveLength(12);
    }
  });
});

// ── XYZ: Z class for erratic revenue ─────────────────────────────────────────

describe("computeAbcXyz — one erratic client → Z class", () => {
  // Client Z: wildly variable payments, one huge spike, rest near zero
  const CLIENT_Z = "7700000099";
  const CLIENT_X1 = "7700000011";
  const CLIENT_X2 = "7700000012";

  const erraticEvents: BusinessEvent[] = [
    // Client Z: spike in month 3, tiny otherwise
    makePaymentIn(CLIENT_Z, 1_000_000_00, "2026-01"),
    makePaymentIn(CLIENT_Z, 100_00,       "2026-02"),
    makePaymentIn(CLIENT_Z, 100_00,       "2026-03"),
    makePaymentIn(CLIENT_Z, 100_00,       "2026-04"),
    makePaymentIn(CLIENT_Z, 1_000_000_00, "2026-05"),
    makePaymentIn(CLIENT_Z, 100_00,       "2026-06"),
    // Two stable clients to meet MIN_ENTITIES threshold
    makePaymentIn(CLIENT_X1, 50_000_00, "2026-01"),
    makePaymentIn(CLIENT_X1, 50_000_00, "2026-02"),
    makePaymentIn(CLIENT_X1, 50_000_00, "2026-03"),
    makePaymentIn(CLIENT_X1, 50_000_00, "2026-04"),
    makePaymentIn(CLIENT_X1, 50_000_00, "2026-05"),
    makePaymentIn(CLIENT_X1, 50_000_00, "2026-06"),
    makePaymentIn(CLIENT_X2, 30_000_00, "2026-01"),
    makePaymentIn(CLIENT_X2, 30_000_00, "2026-02"),
    makePaymentIn(CLIENT_X2, 30_000_00, "2026-03"),
    makePaymentIn(CLIENT_X2, 30_000_00, "2026-04"),
    makePaymentIn(CLIENT_X2, 30_000_00, "2026-05"),
    makePaymentIn(CLIENT_X2, 30_000_00, "2026-06"),
  ];

  const result = computeAbcXyz({
    events: erraticEvents,
    groupBy: "client",
    windowMonths: 6,
  });

  it("returns non-null result", () => {
    expect(result).not.toBeNull();
  });

  it("erratic client Z has xyzClass = Z", () => {
    const entry = result!.entries.find((e) => e.entityId === CLIENT_Z);
    expect(entry?.xyzClass).toBe("Z");
  });
});

// ── Confidence gate: fewer than 3 entities → null ─────────────────────────────

describe("computeAbcXyz — fewer than 3 entities → null", () => {
  const twoClients: BusinessEvent[] = [
    makePaymentIn("9900000001", 500_000_00, "2026-01"),
    makePaymentIn("9900000001", 500_000_00, "2026-02"),
    makePaymentIn("9900000002", 200_000_00, "2026-01"),
    makePaymentIn("9900000002", 200_000_00, "2026-02"),
  ];

  it("returns null when only 2 entities", () => {
    const result = computeAbcXyz({
      events: twoClients,
      groupBy: "client",
      windowMonths: 6,
    });
    expect(result).toBeNull();
  });

  it("returns null for empty events", () => {
    const result = computeAbcXyz({
      events: [],
      groupBy: "client",
    });
    expect(result).toBeNull();
  });
});

// ── Confidence gate: windowMonths < 2 → null ─────────────────────────────────

describe("computeAbcXyz — windowMonths < 2 → null", () => {
  it("returns null when windowMonths = 1", () => {
    const result = computeAbcXyz({
      events: events12,
      groupBy: "client",
      windowMonths: 1,
    });
    expect(result).toBeNull();
  });
});
