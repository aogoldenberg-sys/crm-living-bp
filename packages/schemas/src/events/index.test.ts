import { describe, it, expect } from "vitest";
import { BusinessEvent } from "./index.js";

describe("BusinessEvent discriminatedUnion", () => {
  it("парсит payment_in", () => {
    const event = {
      type: "payment_in",
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      ts: "2026-06-12T10:00:00Z",
      valueDate: "2026-06-12",
      amount: 100_000,
      counterpartyInn: null,
      counterpartyName: "Тест",
      purpose: "Тест",
      matchedInvoiceId: null,
      source: "manual",
    };
    expect(BusinessEvent.parse(event).type).toBe("payment_in");
  });

  it("парсит payment_out", () => {
    const event = {
      type: "payment_out",
      eventId: "550e8400-e29b-41d4-a716-446655440001",
      ts: "2026-06-12T10:00:00Z",
      valueDate: "2026-06-12",
      amount: 50_000,
      counterpartyInn: null,
      counterpartyName: "Тест",
      purpose: "Тест",
      expenseCategory: "зарплата",
      source: "manual",
    };
    expect(BusinessEvent.parse(event).type).toBe("payment_out");
  });

  it("парсит payment_correction", () => {
    const event = {
      type: "payment_correction",
      eventId: "550e8400-e29b-41d4-a716-446655440002",
      ts: "2026-06-12T10:00:00Z",
      correctedEventId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "Ошибка ввода",
      source: "manual",
    };
    expect(BusinessEvent.parse(event).type).toBe("payment_correction");
  });

  it("парсит deal_stage_changed", () => {
    const event = {
      type: "deal_stage_changed",
      eventId: "550e8400-e29b-41d4-a716-446655440010",
      ts: "2026-06-12T10:00:00Z",
      dealId: "550e8400-e29b-41d4-a716-446655440011",
      leadId: "550e8400-e29b-41d4-a716-446655440012",
      fromStage: "new",
      toStage: "won",
      estimatedAmount: null,
      counterpartyInn: null,
      counterpartyName: "Тест",
      managerId: "550e8400-e29b-41d4-a716-446655440013",
      source: "manual",
    };
    expect(BusinessEvent.parse(event).type).toBe("deal_stage_changed");
  });

  it("парсит lead_captured", () => {
    const event = {
      type: "lead_captured",
      eventId: "550e8400-e29b-41d4-a716-446655440020",
      ts: "2026-06-12T10:00:00Z",
      leadId: "550e8400-e29b-41d4-a716-446655440021",
      channel: "direct",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      contactPhone: null,
      contactEmail: null,
      source: "manual",
    };
    expect(BusinessEvent.parse(event).type).toBe("lead_captured");
  });

  it("парсит call_logged", () => {
    const event = {
      type: "call_logged",
      eventId: "550e8400-e29b-41d4-a716-446655440030",
      ts: "2026-06-12T10:00:00Z",
      leadId: null,
      dealId: null,
      managerId: "550e8400-e29b-41d4-a716-446655440031",
      direction: "outbound",
      durationSeconds: 60,
      recordingUrl: null,
      outcome: "answered",
      source: "telephony",
    };
    expect(BusinessEvent.parse(event).type).toBe("call_logged");
  });

  it("отклоняет неизвестный тип события", () => {
    expect(() => BusinessEvent.parse({ type: "unknown_event" })).toThrow();
  });
});
