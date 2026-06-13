import { describe, it, expect } from "vitest";
import { aggregateEvents } from "./aggregate.js";
import type { BusinessEvent } from "@crm/schemas";

// --- фабрики тестовых событий ---

function makePaymentIn(overrides: Partial<{
  eventId: string; valueDate: string; amount: number;
}>): BusinessEvent {
  return {
    type: "payment_in",
    eventId: overrides.eventId ?? "aaaaaaaa-0000-0000-0000-000000000001",
    ts: "2026-06-01T10:00:00Z",
    valueDate: overrides.valueDate ?? "2026-06-01",
    amount: overrides.amount ?? 100_000,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата по счёту 1",
    matchedInvoiceId: null,
    source: "manual",
  };
}

function makePaymentOut(overrides: Partial<{
  eventId: string; valueDate: string; amount: number;
}>): BusinessEvent {
  return {
    type: "payment_out",
    eventId: overrides.eventId ?? "bbbbbbbb-0000-0000-0000-000000000001",
    ts: "2026-06-01T11:00:00Z",
    valueDate: overrides.valueDate ?? "2026-06-01",
    amount: overrides.amount ?? 50_000,
    counterpartyInn: null,
    counterpartyName: "ИП Поставщик",
    purpose: "Аренда офиса",
    expenseCategory: "rent",
    source: "manual",
  };
}

function makeCorrection(correctedEventId: string, eventId?: string): BusinessEvent {
  return {
    type: "payment_correction",
    eventId: eventId ?? "cccccccc-0000-0000-0000-000000000001",
    ts: "2026-06-05T09:00:00Z",
    correctedEventId,
    reason: "Ошибка ввода",
    source: "manual",
  };
}

function makeLeadCaptured(ts: string, leadId: string): BusinessEvent {
  return {
    type: "lead_captured",
    eventId: `lead-${leadId}`,
    ts,
    leadId,
    channel: "website",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    contactPhone: null,
    contactEmail: null,
    source: "manual",
  };
}

function makeDealStageChanged(ts: string, dealId: string, estimatedAmount: number | null): BusinessEvent {
  return {
    type: "deal_stage_changed",
    eventId: `deal-${dealId}`,
    ts,
    dealId,
    leadId: `lead-${dealId}`,
    fromStage: "new",
    toStage: "qualified",
    estimatedAmount,
    counterpartyInn: null,
    counterpartyName: "Клиент",
    managerId: "dddddddd-0000-0000-0000-000000000001",
    source: "manual",
  };
}

function makeCallLogged(ts: string): BusinessEvent {
  return {
    type: "call_logged",
    eventId: `call-${ts}`,
    ts,
    leadId: null,
    dealId: null,
    managerId: "dddddddd-0000-0000-0000-000000000001",
    direction: "inbound",
    durationSeconds: 120,
    recordingUrl: null,
    outcome: "answered",
    source: "telephony",
  };
}

const PERIOD = { from: "2026-06-01" as const, to: "2026-06-30" as const };

describe("aggregateEvents", () => {
  it("возвращает нулевые метрики для пустого массива", () => {
    const result = aggregateEvents([], PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalIn).toBe(0);
    expect(result.value.totalOut).toBe(0);
    expect(result.value.netCash).toBe(0);
    expect(result.value.avgDealAmount).toBeNull();
  });

  it("возвращает INVALID_PERIOD когда from > to", () => {
    const result = aggregateEvents([], { from: "2026-06-30", to: "2026-06-01" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_PERIOD");
  });

  it("суммирует PaymentIn и PaymentOut корректно", () => {
    const events: BusinessEvent[] = [
      makePaymentIn({ amount: 100_000 }),
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000002", amount: 200_000, valueDate: "2026-06-15" }),
      makePaymentOut({ amount: 80_000 }),
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalIn).toBe(300_000);
    expect(result.value.totalOut).toBe(80_000);
    expect(result.value.netCash).toBe(220_000);
  });

  it("исключает события вне периода", () => {
    const events: BusinessEvent[] = [
      makePaymentIn({ valueDate: "2026-05-31", amount: 999_999 }), // до начала
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000002", valueDate: "2026-07-01", amount: 888_888 }), // после конца
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000003", valueDate: "2026-06-15", amount: 10_000 }), // в периоде
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalIn).toBe(10_000);
  });

  // === КЛЮЧЕВОЙ ИНВАРИАНТ: PaymentCorrection ===
  it("PaymentCorrection аннулирует PaymentIn: сумма вычитается из totalIn", () => {
    const originalId = "aaaaaaaa-0000-0000-0000-000000000001";
    const events: BusinessEvent[] = [
      makePaymentIn({ eventId: originalId, amount: 100_000 }),
      makeCorrection(originalId),
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalIn).toBe(0); // аннулирован
  });

  it("PaymentCorrection аннулирует PaymentOut: сумма вычитается из totalOut", () => {
    const originalId = "bbbbbbbb-0000-0000-0000-000000000001";
    const events: BusinessEvent[] = [
      makePaymentOut({ eventId: originalId, amount: 50_000 }),
      makeCorrection(originalId),
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalOut).toBe(0);
  });

  it("коррекция вне периода НЕ аннулирует платёж в периоде", () => {
    const originalId = "aaaaaaaa-0000-0000-0000-000000000001";
    const correctionOutOfPeriod: BusinessEvent = {
      type: "payment_correction",
      eventId: "cccccccc-0000-0000-0000-000000000001",
      ts: "2026-07-05T09:00:00Z", // июль — вне периода
      correctedEventId: originalId,
      reason: "Ошибка",
      source: "manual",
    };
    const events: BusinessEvent[] = [
      makePaymentIn({ eventId: originalId, amount: 100_000 }),
      correctionOutOfPeriod,
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalIn).toBe(100_000); // не аннулирован
  });

  it("считает dealsCount, leadsCount, callsCount", () => {
    const events: BusinessEvent[] = [
      makeDealStageChanged("2026-06-10T12:00:00Z", "d1", 50_000),
      makeDealStageChanged("2026-06-15T12:00:00Z", "d2", 70_000),
      makeLeadCaptured("2026-06-05T08:00:00Z", "l1"),
      makeLeadCaptured("2026-06-06T08:00:00Z", "l2"),
      makeLeadCaptured("2026-06-07T08:00:00Z", "l3"),
      makeCallLogged("2026-06-08T09:00:00Z"),
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dealsCount).toBe(2);
    expect(result.value.leadsCount).toBe(3);
    expect(result.value.callsCount).toBe(1);
  });

  it("avgDealAmount — среднее по сделкам с estimatedAmount", () => {
    const events: BusinessEvent[] = [
      makeDealStageChanged("2026-06-10T12:00:00Z", "d1", 100_000),
      makeDealStageChanged("2026-06-11T12:00:00Z", "d2", 200_000),
      makeDealStageChanged("2026-06-12T12:00:00Z", "d3", null), // не учитывается в среднем
    ];
    const result = aggregateEvents(events, PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dealsCount).toBe(3);
    expect(result.value.avgDealAmount).toBe(150_000);
  });

  it("avgDealAmount = null когда нет сделок", () => {
    const result = aggregateEvents([], PERIOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.avgDealAmount).toBeNull();
  });
});
