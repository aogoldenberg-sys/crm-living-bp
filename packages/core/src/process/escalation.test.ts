import { describe, it, expect } from "vitest";
import type { ProcessInstance, ProcessStep } from "@crm/schemas";
import { escalationLevel, computeEscalations } from "./escalation.js";

const step: ProcessStep = {
  id: "s1",
  name: "Проверка",
  sla_hours: 4,
  responsible_role: "manager",
};

/** Build a breach where breachedAt = now minus `minsAgo` minutes, hoursOverdue = given value */
function makeBreach(hoursOverdue: number, breachedAtIso: string) {
  return {
    stepId: "s1",
    startedAt: "2024-01-01T08:00:00.000Z",
    breachedAt: breachedAtIso,
    hoursOverdue,
  };
}

function makeInstance(
  breaches: ProcessInstance["breaches"],
): ProcessInstance {
  return {
    id: "inst-1",
    process_id: "proc-1",
    current_step_index: 0,
    started_at: "2024-01-01T08:00:00.000Z",
    current_step_started_at: "2024-01-01T08:00:00.000Z",
    breaches,
    status: "active",
  };
}

describe("escalationLevel", () => {
  // Test 1: hoursOverdue=1, elapsed=0 → total=1, sla_hours=4 → assignee
  it("returns assignee when total overdue <= sla_hours", () => {
    const now = "2024-01-01T13:00:00.000Z";
    // breachedAt = now (elapsed = 0), hoursOverdue = 1
    const breach = makeBreach(1, now);
    const state = escalationLevel(breach, step, now);

    expect(state.level).toBe("assignee");
    expect(state.notifyRole).toBe("manager");
    expect(state.hoursOverdue).toBeCloseTo(1, 5);
  });

  // Test 2: hoursOverdue=2, elapsed such that total=5 → 4 < 5 <= 8 → supervisor
  it("returns supervisor when total overdue is between 1× and 2× sla_hours", () => {
    // sla_hours = 4, we want total = 5
    // hoursOverdue = 2, elapsed = 3 → total = 5
    const breachedAt = "2024-01-01T10:00:00.000Z";
    const now = "2024-01-01T13:00:00.000Z"; // 3h after breachedAt
    const breach = makeBreach(2, breachedAt);
    const state = escalationLevel(breach, step, now);

    // total = 2 + 3 = 5, sla_hours = 4 → supervisor
    expect(state.level).toBe("supervisor");
    expect(state.notifyRole).toBe("supervisor");
    expect(state.hoursOverdue).toBeCloseTo(5, 5);
  });

  // Test 3: hoursOverdue=8, step.sla_hours=4 → total > 2×4=8 → owner
  it("returns owner when total overdue exceeds 2× sla_hours", () => {
    const now = "2024-01-01T20:00:00.000Z";
    // breachedAt = now (elapsed = 0), hoursOverdue = 9 > 2*4=8
    const breach = makeBreach(9, now);
    const state = escalationLevel(breach, step, now);

    expect(state.level).toBe("owner");
    expect(state.notifyRole).toBe("owner");
  });

  // Test 4: hoursOverdue=0, elapsed=0 → total=0 → boundary case → "none"
  // The boundary: total <= 0 → "none"; total > 0 → "assignee" or higher
  // At exactly 0 total overdue, code returns "none" (guarded edge case)
  it("returns none at the zero boundary (total <= 0)", () => {
    const now = "2024-01-01T12:00:00.000Z";
    const breach = makeBreach(0, now); // hoursOverdue=0, elapsed=0 → total=0
    const state = escalationLevel(breach, step, now);

    // total = 0 → returns "none" per guard condition
    expect(state.level).toBe("none");
  });

  // Test: message formatting for assignee
  it("formats assignee message correctly", () => {
    const now = "2024-01-01T13:00:00.000Z";
    const breach = makeBreach(2, now); // total = 2
    const state = escalationLevel(breach, step, now);

    expect(state.message).toBe("SLA нарушен: Проверка — 2 ч просрочки");
  });

  // Test: message formatting for supervisor
  it("formats supervisor message correctly", () => {
    const breachedAt = "2024-01-01T10:00:00.000Z";
    const now = "2024-01-01T13:00:00.000Z"; // elapsed = 3h, hoursOverdue = 2 → total = 5
    const breach = makeBreach(2, breachedAt);
    const state = escalationLevel(breach, step, now);

    expect(state.message).toBe("Эскалация: Проверка — 5 ч просрочки");
  });

  // Test: message formatting for owner
  it("formats owner message correctly", () => {
    const now = "2024-01-01T20:00:00.000Z";
    const breach = makeBreach(9, now); // total = 9
    const state = escalationLevel(breach, step, now);

    expect(state.message).toContain("Критично");
    expect(state.message).toContain("владельца");
  });

  // Test 7: time passes — breach at assignee level 1h ago, now at 4 more SLA hours → owner
  it("escalates to owner as time passes (simulated future now)", () => {
    // breach happened, hoursOverdue = 1 (just breached, assignee level at breach time)
    // breachedAt = "base time"
    // now = breachedAt + 8h → elapsed = 8, total = 1 + 8 = 9 > 2*4=8 → owner
    const breachedAt = "2024-01-01T09:00:00.000Z";
    const futureNow = "2024-01-01T17:00:00.000Z"; // 8h later

    const breach = makeBreach(1, breachedAt);
    const state = escalationLevel(breach, step, futureNow);

    // total = 1 + 8 = 9, sla_hours = 4, 2× = 8 → 9 > 8 → owner
    expect(state.level).toBe("owner");
    expect(state.notifyRole).toBe("owner");
  });
});

describe("computeEscalations", () => {
  const stepS1: ProcessStep = {
    id: "s1",
    name: "Проверка",
    sla_hours: 4,
    responsible_role: "manager",
  };
  const stepS2: ProcessStep = {
    id: "s2",
    name: "Согласование",
    sla_hours: 2,
    responsible_role: "director",
  };

  // Test 5: instance with 2 breaches → returns 2 states (one assignee, one owner)
  it("returns escalation states for all non-none breaches", () => {
    const now = "2024-01-01T20:00:00.000Z";

    // s1: hoursOverdue=1, elapsed=0 → total=1, assignee
    const breach1 = { stepId: "s1", startedAt: "2024-01-01T08:00:00.000Z", breachedAt: now, hoursOverdue: 1 };
    // s2: hoursOverdue=9, elapsed=0 → total=9 > 2*2=4 → owner
    const breach2 = { stepId: "s2", startedAt: "2024-01-01T08:00:00.000Z", breachedAt: now, hoursOverdue: 9 };

    const instance = makeInstance([breach1, breach2]);
    const states = computeEscalations(instance, [stepS1, stepS2], now);

    expect(states).toHaveLength(2);
    expect(states[0]!.level).toBe("assignee");
    expect(states[1]!.level).toBe("owner");
  });

  // Test 6: no breaches → returns []
  it("returns empty array when instance has no breaches", () => {
    const now = "2024-01-01T12:00:00.000Z";
    const instance = makeInstance([]);
    const states = computeEscalations(instance, [stepS1, stepS2], now);

    expect(states).toEqual([]);
  });

  it("filters out none-level results", () => {
    const now = "2024-01-01T12:00:00.000Z";
    // hoursOverdue = 0, elapsed = 0 → total = 0 → "none"
    const breach = { stepId: "s1", startedAt: "2024-01-01T08:00:00.000Z", breachedAt: now, hoursOverdue: 0 };
    const instance = makeInstance([breach]);
    const states = computeEscalations(instance, [stepS1], now);

    expect(states).toHaveLength(0);
  });

  it("skips breaches for steps not found in steps array", () => {
    const now = "2024-01-01T12:00:00.000Z";
    const breach = { stepId: "unknown-step", startedAt: "2024-01-01T08:00:00.000Z", breachedAt: now, hoursOverdue: 5 };
    const instance = makeInstance([breach]);
    const states = computeEscalations(instance, [stepS1], now);

    expect(states).toHaveLength(0);
  });
});
