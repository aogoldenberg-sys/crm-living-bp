import { describe, it, expect } from "vitest";
import { computeDataReadiness } from "./compute.js";
import type { ConnectedSources, PlanPresence } from "./types.js";

function connected(...ids: Array<"bank_api" | "ads_api" | "telephony" | "crm_manual" | "plan_document">): ConnectedSources {
  return { active: new Set(ids) };
}

const noPlan: PlanPresence = { hasPlan: false, hasIntake: false };
const withPlan: PlanPresence = { hasPlan: true, hasIntake: false };

describe("computeDataReadiness", () => {
  it("1. empty connected set → all non-crm sources dormant, crm_manual active, viable=true", () => {
    const report = computeDataReadiness(connected(), noPlan);

    const crm = report.sources.find((s) => s.id === "crm_manual");
    expect(crm?.status).toBe("active");

    const nonCrm = report.sources.filter((s) => s.id !== "crm_manual");
    for (const src of nonCrm) {
      expect(src.status).not.toBe("active");
    }

    // viable because crm_manual is always active
    expect(report.viable).toBe(true);
  });

  it("2. bank_api + crm_manual active → uniteconomics module active", () => {
    const report = computeDataReadiness(connected("bank_api", "crm_manual"), noPlan);

    const mod = report.modules.find((m) => m.moduleId === "uniteconomics");
    expect(mod?.status).toBe("active");
    expect(mod?.missingActive).toHaveLength(0);
  });

  it("3. ads_api active → demand module dormant, missingActive contains telephony", () => {
    const report = computeDataReadiness(connected("ads_api"), noPlan);

    const mod = report.modules.find((m) => m.moduleId === "demand");
    expect(mod?.status).toBe("dormant");
    expect(mod?.missingActive).toContain("telephony");
  });

  it("4. plan_document present → causal module active", () => {
    const report = computeDataReadiness(connected(), withPlan);

    const mod = report.modules.find((m) => m.moduleId === "causal");
    expect(mod?.status).toBe("active");
  });

  it("5. all sources active → all modules active, viable=true, activeCount=5", () => {
    const report = computeDataReadiness(
      connected("bank_api", "ads_api", "telephony", "crm_manual", "plan_document"),
      withPlan,
    );

    for (const mod of report.modules) {
      expect(mod.status).toBe("active");
    }
    expect(report.viable).toBe(true);
    expect(report.activeCount).toBe(5);
  });

  it("6. plan.hasPlan=false → plan_document dormant with action='Загрузите бизнес-план'", () => {
    const report = computeDataReadiness(connected(), noPlan);

    const src = report.sources.find((s) => s.id === "plan_document");
    expect(src?.status).toBe("dormant");
    expect(src?.action).toBe("Загрузите бизнес-план");
  });
});
