import { describe, it, expect } from "vitest";
import { OwnerReport } from "./report.js";

const BASE: OwnerReport = {
  reportId: "00000000-0000-0000-0000-000000000001",
  businessId: "biz1",
  periodStart: "2026-07-07",
  periodEnd: "2026-07-13",
  generatedAt: "2026-07-13T06:00:00Z",
  cash: { balance: 500_000_00, gapDate: null, gapAmount: null, confidence: 0.72 },
  topDeviations: [],
  recommendation: null,
  deliveredTo: ["telegram"],
};

describe("OwnerReport", () => {
  it("валидный доклад парсится", () => {
    expect(OwnerReport.parse(BASE)).toMatchObject({ businessId: "biz1" });
  });

  it("topDeviations ≤ 3", () => {
    const dev = { metric: "revenue", planValue: 100_00, factValue: 80_00, deviationPct: -20, causeChain: ["снижение лидов"] };
    expect(() => OwnerReport.parse({ ...BASE, topDeviations: [dev, dev, dev, dev] })).toThrow();
    expect(OwnerReport.parse({ ...BASE, topDeviations: [dev, dev, dev] })).toBeTruthy();
  });

  it("confidence вне [0,1] → ошибка", () => {
    expect(() => OwnerReport.parse({ ...BASE, cash: { ...BASE.cash, confidence: 1.5 } })).toThrow();
    expect(() => OwnerReport.parse({ ...BASE, cash: { ...BASE.cash, confidence: -0.1 } })).toThrow();
  });

  it("gapDate + gapAmount: оба null или оба заполнены — допустимо", () => {
    const withGap = { ...BASE, cash: { ...BASE.cash, gapDate: "2026-08-01", gapAmount: 200_000_00 } };
    expect(OwnerReport.parse(withGap)).toBeTruthy();
  });

  it("deliveredTo: несколько каналов", () => {
    expect(OwnerReport.parse({ ...BASE, deliveredTo: ["telegram", "dashboard"] })).toBeTruthy();
  });

  it("лишнее поле → ошибка (strict)", () => {
    expect(() => OwnerReport.parse({ ...BASE, extra: "x" })).toThrow();
  });

  it("рекомендация nullable", () => {
    expect(OwnerReport.parse({ ...BASE, recommendation: null })).toBeTruthy();
    expect(OwnerReport.parse({ ...BASE, recommendation: "Снизить расходы на маркетинг" })).toBeTruthy();
  });
});
