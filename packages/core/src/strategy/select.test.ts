import { describe, it, expect } from "vitest";
import { selectInitialStrategy } from "./select.js";
import { STRATEGY_LIBRARY } from "./library.js";
import { Strategy } from "@crm/schemas";

describe("selectInitialStrategy", () => {
  it("selects land_and_expand for b2b saas tags", () => {
    const result = selectInitialStrategy({ nicheTags: ["b2b", "saas"] });
    expect(result.strategy.id).toBe("land_and_expand");
    expect(result.fitScore).toBeGreaterThan(0);
  });

  it("selects niche_domination for глэмпинг туризм tags", () => {
    const result = selectInitialStrategy({ nicheTags: ["глэмпинг", "туризм"] });
    expect(result.strategy.id).toBe("niche_domination");
  });

  it("selects blue_ocean for инновации новый рынок tags", () => {
    const result = selectInitialStrategy({ nicheTags: ["инновации", "новый рынок"] });
    expect(result.strategy.id).toBe("blue_ocean");
  });

  it("returns a strategy even for empty nicheTags (fallback)", () => {
    const result = selectInitialStrategy({ nicheTags: [] });
    expect(result.strategy).toBeDefined();
    expect(result.strategy.id).toBeTruthy();
    expect(result.confidence).toBe("initial");
  });

  it("boosts defensive strategies when many red concerns are present", () => {
    const result = selectInitialStrategy({
      nicheTags: [],
      assessment: {
        strengths: [],
        concerns: [
          { description: "critical issue 1", severity: "red" },
          { description: "critical issue 2", severity: "red" },
          { description: "critical issue 3", severity: "red" },
        ],
        gaps: [],
      },
    });
    // Should select niche_domination or cost_leadership (defensive)
    expect(["niche_domination", "cost_leadership"]).toContain(result.strategy.id);
  });

  it("all results have confidence=initial and non-empty calibrationNote", () => {
    const inputs = [
      { nicheTags: ["b2b", "saas"] },
      { nicheTags: ["премиум", "luxury"] },
      { nicheTags: ["инновации"] },
      { nicheTags: [] },
      { nicheTags: ["туризм", "нишевый"] },
    ];
    for (const input of inputs) {
      const result = selectInitialStrategy(input);
      expect(result.confidence).toBe("initial");
      expect(result.calibrationNote.length).toBeGreaterThan(0);
    }
  });

  it("STRATEGY_LIBRARY has 5 entries, all parse without Zod errors", () => {
    expect(STRATEGY_LIBRARY).toHaveLength(5);
    for (const strategy of STRATEGY_LIBRARY) {
      const parsed = Strategy.safeParse(strategy);
      expect(parsed.success).toBe(true);
    }
  });
});
