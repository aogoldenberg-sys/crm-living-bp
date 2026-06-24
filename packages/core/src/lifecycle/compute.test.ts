import { describe, it, expect } from "vitest";
import { computeBusinessStage } from "./compute.js";
import type { BusinessEvent } from "@crm/schemas";

// --- фабрики тестовых событий ---

let idCounter = 0;
function nextId(): string {
  idCounter++;
  const hex = idCounter.toString(16).padStart(12, "0");
  return `aaaaaaaa-0000-0000-0000-${hex}`;
}

function makePaymentIn(ts: string, amount: number): BusinessEvent {
  return {
    type: "payment_in",
    eventId: nextId(),
    ts,
    valueDate: ts.slice(0, 10),
    amount,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата по счёту",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "demo",
  };
}

// --- тесты ---

describe("computeBusinessStage", () => {
  it("1. No events, no plan → startup, historyMonths=0", () => {
    const result = computeBusinessStage({
      events: [],
      hasPlan: false,
      referenceDate: "2026-06-24",
    });
    expect(result.stage).toBe("startup");
    expect(result.historyMonths).toBe(0);
    expect(result.priorities.length).toBeGreaterThan(0);
  });

  it("2. No events, hasPlan=true → startup, rationale contains 'план'", () => {
    const result = computeBusinessStage({
      events: [],
      hasPlan: true,
      referenceDate: "2026-06-24",
    });
    expect(result.stage).toBe("startup");
    expect(result.rationale.toLowerCase()).toContain("план");
  });

  it("3. 1 month of revenue data → startup (insufficient history)", () => {
    const result = computeBusinessStage({
      events: [
        makePaymentIn("2026-06-01T10:00:00Z", 100_000),
        makePaymentIn("2026-06-15T10:00:00Z", 200_000),
      ],
      hasPlan: false,
      referenceDate: "2026-06-24",
    });
    expect(result.stage).toBe("startup");
  });

  it("4. 3 months growing >10% MoM → growth", () => {
    // Jan: 100k, Feb: 120k (+20%), Mar: 145k (+20.8%)
    const result = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 120_000),
        makePaymentIn("2026-03-15T10:00:00Z", 145_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(result.stage).toBe("growth");
  });

  it("5. 3 months flat (0-5% change) → maturity", () => {
    // Jan: 100k, Feb: 101k (+1%), Mar: 102k (+0.99%)
    const result = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 101_000),
        makePaymentIn("2026-03-15T10:00:00Z", 102_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(result.stage).toBe("maturity");
  });

  it("6. 3 months declining >10% MoM → decline", () => {
    // Jan: 100k, Feb: 88k (-12%), Mar: 77k (-12.5%)
    const result = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 88_000),
        makePaymentIn("2026-03-15T10:00:00Z", 77_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(result.stage).toBe("decline");
  });

  it("7. Mixed trend (up then down) → maturity (not sustained decline)", () => {
    // Jan: 100k, Feb: 130k (+30%), Mar: 110k (-15%)
    const result = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 130_000),
        makePaymentIn("2026-03-15T10:00:00Z", 110_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(result.stage).toBe("maturity");
  });

  it("8. priorities.length > 0 for each stage", () => {
    const stages = ["startup", "growth", "maturity", "decline"] as const;

    // startup (no events)
    const startupResult = computeBusinessStage({
      events: [],
      hasPlan: false,
      referenceDate: "2026-06-24",
    });
    expect(startupResult.stage).toBe("startup");
    expect(startupResult.priorities.length).toBeGreaterThan(0);

    // growth
    const growthResult = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 120_000),
        makePaymentIn("2026-03-15T10:00:00Z", 145_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(growthResult.stage).toBe("growth");
    expect(growthResult.priorities.length).toBeGreaterThan(0);

    // maturity
    const maturityResult = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 101_000),
        makePaymentIn("2026-03-15T10:00:00Z", 102_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(maturityResult.stage).toBe("maturity");
    expect(maturityResult.priorities.length).toBeGreaterThan(0);

    // decline
    const declineResult = computeBusinessStage({
      events: [
        makePaymentIn("2026-01-15T10:00:00Z", 100_000),
        makePaymentIn("2026-02-15T10:00:00Z", 88_000),
        makePaymentIn("2026-03-15T10:00:00Z", 77_000),
      ],
      hasPlan: false,
      referenceDate: "2026-03-31",
    });
    expect(declineResult.stage).toBe("decline");
    expect(declineResult.priorities.length).toBeGreaterThan(0);

    // ensure all 4 stages are covered
    void stages;
  });
});
