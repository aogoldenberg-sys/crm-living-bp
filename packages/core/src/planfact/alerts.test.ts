import { describe, it, expect } from "vitest";
import { deriveAlerts } from "./alerts.js";
import type { PlanFactMetrics } from "./aggregate.js";
import type { PlanAssumptions } from "./alerts.js";

function makeMetrics(overrides: Partial<PlanFactMetrics> = {}): PlanFactMetrics {
  return {
    totalIn: 1_000_000,
    totalOut: 400_000,
    netCash: 600_000,
    dealsCount: 10,
    leadsCount: 100,
    callsCount: 50,
    avgDealAmount: 100_000,
    periodFrom: "2026-06-01",
    periodTo: "2026-06-30",
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanAssumptions> = {}): PlanAssumptions {
  return {
    revenuePlan: 1_000_000,
    fixedCostsPlan: 300_000,
    conversionPct: 10,
    cacPlan: 5_000,
    cacFact: 5_000,
    ...overrides,
  };
}

describe("deriveAlerts — выручка", () => {
  it("нет алерта когда выручка в норме", () => {
    const alerts = deriveAlerts(makeMetrics({ totalIn: 1_000_000 }), makePlan());
    const revenue = alerts.filter(a => a.metric === "revenue");
    expect(revenue).toHaveLength(0);
  });

  it("жёлтый алерт при −10% выручки", () => {
    // totalIn = 900_000 = -10% от плана 1_000_000
    const alerts = deriveAlerts(makeMetrics({ totalIn: 900_000 }), makePlan());
    const revenue = alerts.filter(a => a.metric === "revenue");
    expect(revenue).toHaveLength(1);
    expect(revenue[0]?.severity).toBe("yellow");
  });

  it("красный алерт при −25% выручки", () => {
    const alerts = deriveAlerts(makeMetrics({ totalIn: 750_000 }), makePlan());
    const revenue = alerts.filter(a => a.metric === "revenue");
    expect(revenue).toHaveLength(1);
    expect(revenue[0]?.severity).toBe("red");
  });
});

describe("deriveAlerts — конверсия воронки", () => {
  it("нет алерта при нормальной конверсии", () => {
    // 10 deals / 100 leads = 10% = план
    const alerts = deriveAlerts(makeMetrics(), makePlan());
    const conv = alerts.filter(a => a.metric === "conversion");
    expect(conv).toHaveLength(0);
  });

  it("жёлтый алерт при −15% конверсии", () => {
    // plan: 10%, fact: 8.5% → (8.5-10)/10*100 = −15% ровно
    const alerts = deriveAlerts(
      makeMetrics({ dealsCount: 17, leadsCount: 200 }), // 8.5%
      makePlan({ conversionPct: 10 }),
    );
    const conv = alerts.filter(a => a.metric === "conversion");
    expect(conv).toHaveLength(1);
    expect(conv[0]?.severity).toBe("yellow");
  });

  it("нет алерта когда нет лидов (деление на ноль защищено)", () => {
    const alerts = deriveAlerts(makeMetrics({ leadsCount: 0, dealsCount: 0 }), makePlan());
    const conv = alerts.filter(a => a.metric === "conversion");
    expect(conv).toHaveLength(0);
  });
});

describe("deriveAlerts — CAC", () => {
  it("нет алерта при CAC в норме", () => {
    const alerts = deriveAlerts(makeMetrics(), makePlan({ cacPlan: 5_000, cacFact: 5_000 }));
    const cac = alerts.filter(a => a.metric === "cac");
    expect(cac).toHaveLength(0);
  });

  it("жёлтый алерт при CAC +20%", () => {
    const alerts = deriveAlerts(makeMetrics(), makePlan({ cacPlan: 5_000, cacFact: 6_000 }));
    const cac = alerts.filter(a => a.metric === "cac");
    expect(cac).toHaveLength(1);
    expect(cac[0]?.severity).toBe("yellow");
  });

  it("красный алерт при CAC +35%", () => {
    const alerts = deriveAlerts(makeMetrics(), makePlan({ cacPlan: 5_000, cacFact: 6_750 }));
    const cac = alerts.filter(a => a.metric === "cac");
    expect(cac).toHaveLength(1);
    expect(cac[0]?.severity).toBe("red");
  });
});

describe("deriveAlerts — кассовый остаток", () => {
  it("нет алерта при покрытии 2× постоянных затрат", () => {
    // netCash = 600_000, fixedCosts = 300_000 → 2.0×
    const alerts = deriveAlerts(makeMetrics(), makePlan({ fixedCostsPlan: 300_000 }));
    const cash = alerts.filter(a => a.metric === "cash_balance");
    expect(cash).toHaveLength(0);
  });

  it("жёлтый алерт при покрытии 1.2× (< 1.5×)", () => {
    // netCash = 360_000, fixedCosts = 300_000 → 1.2×
    const alerts = deriveAlerts(makeMetrics({ netCash: 360_000 }), makePlan({ fixedCostsPlan: 300_000 }));
    const cash = alerts.filter(a => a.metric === "cash_balance");
    expect(cash).toHaveLength(1);
    expect(cash[0]?.severity).toBe("yellow");
  });

  it("красный алерт при покрытии 0.8× (< 1.0×)", () => {
    // netCash = 240_000, fixedCosts = 300_000 → 0.8×
    const alerts = deriveAlerts(makeMetrics({ netCash: 240_000 }), makePlan({ fixedCostsPlan: 300_000 }));
    const cash = alerts.filter(a => a.metric === "cash_balance");
    expect(cash).toHaveLength(1);
    expect(cash[0]?.severity).toBe("red");
  });
});

describe("deriveAlerts — несколько алертов одновременно", () => {
  it("выручка + кассовый остаток красные одновременно", () => {
    const alerts = deriveAlerts(
      makeMetrics({ totalIn: 700_000, netCash: 100_000 }),
      makePlan({ revenuePlan: 1_000_000, fixedCostsPlan: 300_000 }),
    );
    expect(alerts.filter(a => a.severity === "red")).toHaveLength(2);
  });
});
