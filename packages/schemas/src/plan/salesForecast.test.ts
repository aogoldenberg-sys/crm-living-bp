import { describe, it, expect } from "vitest";
import { SalesForecast, SalesForecastScenario } from "./salesForecast.js";

const validScenario = {
  scenarioId: "550e8400-e29b-41d4-a716-446655440050",
  name: "Базовый",
  kind: "base" as const,
  avgCheckKopecks: 50_000,
  dealsPerMonth: 10,
  conversionBps: 2000,
  projectedRevenue: 6_000_000,
};

const validForecast = {
  periodStart: "2026-07-01",
  forecastPeriodMonths: 12,
  scenarios: [validScenario],
  activeScenarioId: "550e8400-e29b-41d4-a716-446655440050",
  leadsPerMonth: 50,
};

describe("SalesForecastScenario", () => {
  it("принимает валидный сценарий", () => {
    expect(SalesForecastScenario.parse(validScenario)).toEqual(validScenario);
  });
  it("отклоняет float в avgCheckKopecks", () => {
    expect(() =>
      SalesForecastScenario.parse({ ...validScenario, avgCheckKopecks: 50_000.5 }),
    ).toThrow();
  });
  it("отклоняет дробное количество сделок", () => {
    expect(() =>
      SalesForecastScenario.parse({ ...validScenario, dealsPerMonth: 10.5 }),
    ).toThrow();
  });
  it("отклоняет conversionBps > 10000", () => {
    expect(() =>
      SalesForecastScenario.parse({ ...validScenario, conversionBps: 10001 }),
    ).toThrow();
  });
  it("отклоняет нулевую конверсию", () => {
    expect(() =>
      SalesForecastScenario.parse({ ...validScenario, conversionBps: 0 }),
    ).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => SalesForecastScenario.parse({ ...validScenario, note: "x" })).toThrow();
  });
});

describe("SalesForecast", () => {
  it("принимает валидный прогноз", () => {
    expect(SalesForecast.parse(validForecast)).toEqual(validForecast);
  });
  it("отклоняет пустой массив сценариев", () => {
    expect(() => SalesForecast.parse({ ...validForecast, scenarios: [] })).toThrow();
  });
  it("отклоняет период более 60 месяцев", () => {
    expect(() => SalesForecast.parse({ ...validForecast, forecastPeriodMonths: 61 })).toThrow();
  });
  it("отклоняет период 0 месяцев", () => {
    expect(() => SalesForecast.parse({ ...validForecast, forecastPeriodMonths: 0 })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => SalesForecast.parse({ ...validForecast, author: "anna" })).toThrow();
  });
});
