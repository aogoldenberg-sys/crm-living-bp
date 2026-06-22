import { describe, it, expect } from "vitest";
import { buildRoadmap } from "./build.js";

describe("buildRoadmap", () => {
  const baseInput = {
    businessId: "test",
    assessment: {
      concerns: [
        { description: "Нет анализа конкурентов", severity: "red" as const },
        { description: "Слабая финансовая модель", severity: "yellow" as const },
      ],
      gaps: [{ missingSection: "Маркетинговая стратегия" }],
    },
    confidence: 0.86,
    milestones: [],
    creditsAvailable: false,
  };

  it("создаёт refinement-задачи из concerns и gaps", () => {
    const rm = buildRoadmap(baseInput);
    const refinement = rm.items.filter((i) => i.phase === "refinement");
    expect(refinement).toHaveLength(3); // 2 concerns + 1 gap
  });

  it("red concern → priority high", () => {
    const rm = buildRoadmap(baseInput);
    const redItem = rm.items.find((i) => i.sourceRef.type === "concern" && i.sourceRef.index === 0);
    expect(redItem?.priority).toBe("high");
  });

  it("yellow concern → priority medium", () => {
    const rm = buildRoadmap(baseInput);
    const yellowItem = rm.items.find((i) => i.sourceRef.type === "concern" && i.sourceRef.index === 1);
    expect(yellowItem?.priority).toBe("medium");
  });

  it("gap → priority low", () => {
    const rm = buildRoadmap(baseInput);
    const gapItem = rm.items.find((i) => i.sourceRef.type === "gap");
    expect(gapItem?.priority).toBe("low");
  });

  it("без кредитов → все A1 (creditsAvailable=false)", () => {
    const rm = buildRoadmap(baseInput);
    const refinement = rm.items.filter((i) => i.phase === "refinement");
    for (const item of refinement) {
      expect(item.autonomy).toBe("A1");
    }
  });

  it("с кредитами и confidence>=0.9 → A3 для concerns", () => {
    const rm = buildRoadmap({ ...baseInput, confidence: 0.95, creditsAvailable: true });
    const concerns = rm.items.filter((i) => i.sourceRef.type === "concern");
    for (const item of concerns) {
      expect(item.autonomy).toBe("A3");
    }
  });

  it("confidence < 0.9 → A1 даже с кредитами (confidence-gate §14)", () => {
    const rm = buildRoadmap({ ...baseInput, confidence: 0.85, creditsAvailable: true });
    const concerns = rm.items.filter((i) => i.sourceRef.type === "concern");
    for (const item of concerns) {
      expect(item.autonomy).toBe("A1");
    }
  });

  it("без milestones → executionPhaseEmpty=true, нет execution-items", () => {
    const rm = buildRoadmap(baseInput);
    expect(rm.executionPhaseEmpty).toBe(true);
    expect(rm.items.filter((i) => i.phase === "execution")).toHaveLength(0);
  });

  it("с milestones → execution-items, A2", () => {
    const rm = buildRoadmap({
      ...baseInput,
      milestones: [
        { id: "m1", title: "Открытие продаж", date: "2025-09-01", status: "pending", critical: true },
      ],
    });
    const exec = rm.items.filter((i) => i.phase === "execution");
    expect(exec).toHaveLength(1);
    expect(exec[0]?.autonomy).toBe("A2");
    expect(rm.executionPhaseEmpty).toBe(false);
  });

  it("refinement сортируется: high > medium > low", () => {
    const rm = buildRoadmap(baseInput);
    const priorities = rm.items
      .filter((i) => i.phase === "refinement")
      .map((i) => i.priority);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i]!]).toBeGreaterThanOrEqual(order[priorities[i - 1]!]);
    }
  });
});
