import { describe, it, expect } from "vitest";
import { DealStageChanged } from "./deal.js";

const valid = {
  type: "deal_stage_changed" as const,
  eventId: "550e8400-e29b-41d4-a716-446655440010",
  ts: "2026-06-12T09:00:00Z",
  dealId: "550e8400-e29b-41d4-a716-446655440011",
  leadId: "550e8400-e29b-41d4-a716-446655440012",
  fromStage: "new",
  toStage: "qualified",
  estimatedAmount: 500_000,
  counterpartyInn: "7707083893",
  counterpartyName: "ООО Тест",
  managerId: "550e8400-e29b-41d4-a716-446655440013",
  source: "manual" as const,
};

describe("DealStageChanged", () => {
  it("принимает валидное событие", () => {
    expect(DealStageChanged.parse(valid)).toEqual(valid);
  });
  it("принимает null estimatedAmount", () => {
    expect(DealStageChanged.parse({ ...valid, estimatedAmount: null })).toBeTruthy();
  });
  it("отклоняет float в estimatedAmount", () => {
    expect(() => DealStageChanged.parse({ ...valid, estimatedAmount: 500_000.5 })).toThrow();
  });
  it("отклоняет пустую стадию", () => {
    expect(() => DealStageChanged.parse({ ...valid, toStage: "" })).toThrow();
  });
  it("отклоняет некорректный UUID managerId", () => {
    expect(() => DealStageChanged.parse({ ...valid, managerId: "not-uuid" })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => DealStageChanged.parse({ ...valid, extra: "x" })).toThrow();
  });
});
