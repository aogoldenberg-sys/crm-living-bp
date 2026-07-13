import { describe, it, expect } from "vitest";
import { ScenarioResult, PlanDiff, ScenarioDecision } from "./scenario.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID2 = "660e8400-e29b-41d4-a716-446655440001";

describe("ScenarioResult", () => {
  const base = {
    scenarioId: VALID_UUID,
    runId: VALID_UUID2,
    levers: ["scale"],
    projectedForecast: { gapDate: null, gapAmount: null, confidence: 0.8 },
    gapAvoidedProbability: 0.75,
    impactOnGoal: 500000,
    complexity: "low" as const,
    drivers: ["scale"],
  };

  it("parses valid result", () => {
    expect(ScenarioResult.safeParse(base).success).toBe(true);
  });

  it("rejects confidence > 1", () => {
    const r = { ...base, projectedForecast: { ...base.projectedForecast, confidence: 1.1 } };
    expect(ScenarioResult.safeParse(r).success).toBe(false);
  });

  it("rejects gapAvoidedProbability < 0", () => {
    expect(ScenarioResult.safeParse({ ...base, gapAvoidedProbability: -0.1 }).success).toBe(false);
  });

  it("accepts confidence boundary 0 and 1", () => {
    expect(ScenarioResult.safeParse({ ...base, projectedForecast: { ...base.projectedForecast, confidence: 0 } }).success).toBe(true);
    expect(ScenarioResult.safeParse({ ...base, projectedForecast: { ...base.projectedForecast, confidence: 1 } }).success).toBe(true);
  });

  it("rejects extra fields (strict)", () => {
    expect(ScenarioResult.safeParse({ ...base, extra: "x" }).success).toBe(false);
  });

  it("rejects drivers > 3 items", () => {
    expect(ScenarioResult.safeParse({ ...base, drivers: ["a", "b", "c", "d"] }).success).toBe(false);
  });
});

describe("PlanDiff", () => {
  const base = { field: "avg_deal", before: "100000", after: "120000", humanReadable: "Изменение" };

  it("parses valid diff", () => {
    expect(PlanDiff.safeParse(base).success).toBe(true);
  });

  it("rejects empty field", () => {
    expect(PlanDiff.safeParse({ ...base, field: "" }).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(PlanDiff.safeParse({ ...base, extra: true }).success).toBe(false);
  });
});

describe("ScenarioDecision", () => {
  const base = {
    scenarioId: VALID_UUID,
    runId: VALID_UUID2,
    decidedBy: "uid123",
    decidedAt: "2026-07-13T10:00:00Z",
    accepted: true,
    newPlanId: null,
  };

  it("parses valid decision", () => {
    expect(ScenarioDecision.safeParse(base).success).toBe(true);
  });

  it("rejects non-UTC datetime", () => {
    expect(ScenarioDecision.safeParse({ ...base, decidedAt: "2026-07-13T10:00:00+03:00" }).success).toBe(false);
  });

  it("rejects empty decidedBy", () => {
    expect(ScenarioDecision.safeParse({ ...base, decidedBy: "" }).success).toBe(false);
  });
});
