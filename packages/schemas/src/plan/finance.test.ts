import { describe, it, expect } from "vitest";
import { FinanceAnalysis, FinancialSnapshot } from "./finance.js";

const validSnapshot = {
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  revenue: 1_000_000,
  variableCosts: 400_000,
  fixedCosts: 200_000,
  grossProfit: 600_000,
  netProfit: 400_000,
};

const validAnalysis = {
  snapshotDate: "2026-06-30",
  grossMarginBps: 6000,
  netMarginBps: 4000,
  paybackMonths: 12,
  roiBps: 3500,
  breakEvenRevenue: 200_000,
  snapshot: validSnapshot,
};

describe("FinancialSnapshot", () => {
  it("принимает валидный снимок", () => {
    expect(FinancialSnapshot.parse(validSnapshot)).toEqual(validSnapshot);
  });
  it("принимает отрицательный netProfit (убыток)", () => {
    expect(FinancialSnapshot.parse({ ...validSnapshot, netProfit: -50_000 })).toBeTruthy();
  });
  it("отклоняет float в revenue", () => {
    expect(() => FinancialSnapshot.parse({ ...validSnapshot, revenue: 1_000_000.5 })).toThrow();
  });
  it("отклоняет отрицательный variableCosts", () => {
    expect(() => FinancialSnapshot.parse({ ...validSnapshot, variableCosts: -1 })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => FinancialSnapshot.parse({ ...validSnapshot, currency: "RUB" })).toThrow();
  });
});

describe("FinanceAnalysis", () => {
  it("принимает валидный анализ", () => {
    expect(FinanceAnalysis.parse(validAnalysis)).toEqual(validAnalysis);
  });
  it("принимает null paybackMonths (не окупается)", () => {
    expect(FinanceAnalysis.parse({ ...validAnalysis, paybackMonths: null })).toBeTruthy();
  });
  it("принимает отрицательный roiBps", () => {
    expect(FinanceAnalysis.parse({ ...validAnalysis, roiBps: -500 })).toBeTruthy();
  });
  it("принимает отрицательный netMarginBps", () => {
    expect(FinanceAnalysis.parse({ ...validAnalysis, netMarginBps: -1000 })).toBeTruthy();
  });
  it("отклоняет grossMarginBps > 10000", () => {
    expect(() => FinanceAnalysis.parse({ ...validAnalysis, grossMarginBps: 10001 })).toThrow();
  });
  it("отклоняет float в breakEvenRevenue", () => {
    expect(() =>
      FinanceAnalysis.parse({ ...validAnalysis, breakEvenRevenue: 200_000.5 }),
    ).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => FinanceAnalysis.parse({ ...validAnalysis, note: "test" })).toThrow();
  });
});
