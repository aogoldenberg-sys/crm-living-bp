import { describe, it, expect } from "vitest";
import { ExternalSignal, DemandTrendPoint, CounterpartyRiskSignal } from "./monitor.js";

const TS = "2026-07-13T05:00:00Z";

describe("ExternalSignal", () => {
  it("valid", () => {
    const r = ExternalSignal.safeParse({
      type: "external_signal",
      eventId: "11111111-1111-1111-1111-111111111111",
      ts: TS, source: "cbr", category: "macro",
      title: "ЦБ снизил ставку до 14%", summary: "Решение от 13.07",
      url: "https://cbr.ru", impactHint: "positive", relatedInn: null,
    });
    expect(r.success).toBe(true);
  });

  it("url:null — валидно", () => {
    const r = ExternalSignal.safeParse({
      type: "external_signal", eventId: "11111111-1111-1111-1111-111111111111",
      ts: TS, source: "pravo_rss", category: "regulatory",
      title: "Приказ №123", summary: "Текст", url: null, impactHint: "neutral", relatedInn: null,
    });
    expect(r.success).toBe(true);
  });

  it("неверная категория → ошибка", () => {
    const r = ExternalSignal.safeParse({
      type: "external_signal", eventId: "11111111-1111-1111-1111-111111111111",
      ts: TS, source: "cbr", category: "unknown",
      title: "x", summary: "y", url: null, impactHint: "neutral", relatedInn: null,
    });
    expect(r.success).toBe(false);
  });

  it("strict — лишнее поле → ошибка", () => {
    const r = ExternalSignal.safeParse({
      type: "external_signal", eventId: "11111111-1111-1111-1111-111111111111",
      ts: TS, source: "cbr", category: "macro",
      title: "x", summary: "y", url: null, impactHint: "neutral", relatedInn: null,
      extra: "!",
    });
    expect(r.success).toBe(false);
  });
});

describe("DemandTrendPoint", () => {
  it("valid", () => {
    const r = DemandTrendPoint.safeParse({
      type: "demand_trend", eventId: "22222222-2222-2222-2222-222222222222",
      ts: TS, keyword: "глэмпинг", period: "2026-06-01",
      volume: 4500, trendScore: 0.8, source: "wordstat",
    });
    expect(r.success).toBe(true);
  });

  it("trendScore > 1 → ошибка", () => {
    const r = DemandTrendPoint.safeParse({
      type: "demand_trend", eventId: "22222222-2222-2222-2222-222222222222",
      ts: TS, keyword: "x", period: "2026-06-01", volume: 100, trendScore: 1.5, source: "wordstat",
    });
    expect(r.success).toBe(false);
  });

  it("отрицательный volume → ошибка", () => {
    const r = DemandTrendPoint.safeParse({
      type: "demand_trend", eventId: "22222222-2222-2222-2222-222222222222",
      ts: TS, keyword: "x", period: "2026-06-01", volume: -1, trendScore: 0, source: "wordstat",
    });
    expect(r.success).toBe(false);
  });
});

describe("CounterpartyRiskSignal", () => {
  it("valid red", () => {
    const r = CounterpartyRiskSignal.safeParse({
      type: "counterparty_risk", eventId: "33333333-3333-3333-3333-333333333333",
      ts: TS, inn: "9703235411", checkId: "registry_status",
      severity: "red", details: "Ликвидация", sourceUrl: null,
    });
    expect(r.success).toBe(true);
  });

  it("ИНН невалидный → ошибка", () => {
    const r = CounterpartyRiskSignal.safeParse({
      type: "counterparty_risk", eventId: "33333333-3333-3333-3333-333333333333",
      ts: TS, inn: "123", checkId: "solvency",
      severity: "yellow", details: "x", sourceUrl: null,
    });
    expect(r.success).toBe(false);
  });
});
