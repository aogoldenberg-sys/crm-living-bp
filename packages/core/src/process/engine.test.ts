import { describe, it, expect } from "vitest";
import type { Process, ProcessInstance } from "@crm/schemas";
import { advanceInstance, detectBreach, applyBreachCheck } from "./engine.js";

const sampleProcess: Process = {
  id: "onboarding",
  name: "Client Onboarding",
  steps: [
    { id: "step1", name: "Intake", sla_hours: 1, responsible_role: "manager" },
    { id: "step2", name: "Setup", sla_hours: 2, responsible_role: "tech" },
    { id: "step3", name: "Review", sla_hours: 1, responsible_role: "manager" },
  ],
};

function makeInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: "inst-1",
    process_id: "onboarding",
    current_step_index: 0,
    started_at: "2024-01-01T10:00:00.000Z",
    current_step_started_at: "2024-01-01T10:00:00.000Z",
    breaches: [],
    status: "active",
    ...overrides,
  };
}

describe("advanceInstance", () => {
  it("moves to next step", () => {
    const instance = makeInstance({ current_step_index: 0 });
    const now = "2024-01-01T11:00:00.000Z";
    const result = advanceInstance(instance, sampleProcess, now);

    expect(result.completed).toBe(false);
    expect(result.instance.current_step_index).toBe(1);
    expect(result.instance.current_step_started_at).toBe(now);
    expect(result.instance.status).toBe("active");
  });

  it("on last step completes the process", () => {
    const instance = makeInstance({ current_step_index: 2 });
    const now = "2024-01-01T11:00:00.000Z";
    const result = advanceInstance(instance, sampleProcess, now);

    expect(result.completed).toBe(true);
    expect(result.instance.status).toBe("completed");
  });

  it("on completed instance is a no-op", () => {
    const instance = makeInstance({ status: "completed", current_step_index: 2 });
    const now = "2024-01-01T11:00:00.000Z";
    const result = advanceInstance(instance, sampleProcess, now);

    expect(result.completed).toBe(false);
    expect(result.instance).toBe(instance);
  });
});

describe("detectBreach", () => {
  it("returns null when within SLA", () => {
    // step1 has sla_hours: 1, started 30 minutes ago
    const startedAt = "2024-01-01T10:00:00.000Z";
    const now = "2024-01-01T10:30:00.000Z"; // 30 min later
    const instance = makeInstance({
      current_step_index: 0,
      current_step_started_at: startedAt,
    });

    const breach = detectBreach(instance, sampleProcess, now);
    expect(breach).toBeNull();
  });

  it("returns breach when SLA exceeded", () => {
    // step1 has sla_hours: 1, started 2 hours ago
    const startedAt = "2024-01-01T10:00:00.000Z";
    const now = "2024-01-01T12:00:00.000Z"; // 2h later
    const instance = makeInstance({
      current_step_index: 0,
      current_step_started_at: startedAt,
    });

    const breach = detectBreach(instance, sampleProcess, now);
    expect(breach).not.toBeNull();
    expect(breach!.stepId).toBe("step1");
    expect(breach!.hoursOverdue).toBeCloseTo(1, 5);
  });
});

describe("applyBreachCheck", () => {
  it("does not add duplicate breach for same step", () => {
    const startedAt = "2024-01-01T10:00:00.000Z";
    const now = "2024-01-01T12:00:00.000Z"; // 2h later, SLA=1h → breach
    const instance = makeInstance({
      current_step_index: 0,
      current_step_started_at: startedAt,
    });

    // Apply once
    const afterFirst = applyBreachCheck(instance, sampleProcess, now);
    expect(afterFirst.breaches).toHaveLength(1);

    // Apply again — should not duplicate
    const afterSecond = applyBreachCheck(afterFirst, sampleProcess, now);
    expect(afterSecond.breaches).toHaveLength(1);
    expect(afterSecond).toBe(afterFirst);
  });
});
