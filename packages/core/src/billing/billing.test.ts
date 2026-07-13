import { describe, it, expect } from "vitest";
import { checkAccess } from "./gate.js";
import { startTrial } from "./trial.js";
import type { Entitlements } from "@crm/schemas";

const NOW = "2026-07-13T10:00:00Z";

function base(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    businessId: "biz1",
    plan: "free",
    paidUntil: null,
    freeComplianceUsed: false,
    freeReportUsed: false,
    updatedAt: NOW,
    tier: "free",
    trialEndsAt: null,
    purchases: [],
    usage: { complianceCases: 0, taxReports: 0, planAssessRuns: 0 },
    ...overrides,
  };
}

// ── checkAccess ───────────────────────────────────────────────────────────────

describe("checkAccess / plan_assess", () => {
  it("free без покупки → denied", () => {
    expect(checkAccess(base(), "plan_assess", "p1", NOW).allowed).toBe(false);
  });

  it("покупка diag на planId → allowed", () => {
    const ent = base({ purchases: [{ product: "diag", planId: "p1", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_assess", "p1", NOW).allowed).toBe(true);
  });

  it("покупка на другой planId → denied", () => {
    const ent = base({ purchases: [{ product: "diag", planId: "p2", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_assess", "p1", NOW).allowed).toBe(false);
  });

  it("подписка pulse → allowed", () => {
    expect(checkAccess(base({ tier: "pulse" }), "plan_assess", null, NOW).allowed).toBe(true);
  });

  it("активный триал → allowed", () => {
    const ent = base({ trialEndsAt: "2026-07-27T23:59:59Z" });
    expect(checkAccess(ent, "plan_assess", null, NOW).allowed).toBe(true);
  });

  it("триал истёк → denied", () => {
    const ent = base({ trialEndsAt: "2026-07-12T23:59:59Z" });
    expect(checkAccess(ent, "plan_assess", null, NOW).allowed).toBe(false);
  });

  it("последний день триала → allowed", () => {
    const ent = base({ trialEndsAt: "2026-07-13T10:00:00Z" });
    expect(checkAccess(ent, "plan_assess", null, NOW).allowed).toBe(true);
  });
});

describe("checkAccess / plan_reform", () => {
  it("diag покупка не достаточна → denied", () => {
    const ent = base({ purchases: [{ product: "diag", planId: "p1", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_reform", "p1", NOW).allowed).toBe(false);
  });

  it("live_plan покупка → allowed", () => {
    const ent = base({ purchases: [{ product: "live_plan", planId: "p1", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_reform", "p1", NOW).allowed).toBe(true);
  });

  it("grant_pro покупка (выше live_plan) → allowed", () => {
    const ent = base({ purchases: [{ product: "grant_pro", planId: "p1", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_reform", "p1", NOW).allowed).toBe(true);
  });

  it("pulse подписки НЕТ — нужен operator → denied", () => {
    expect(checkAccess(base({ tier: "pulse" }), "plan_reform", null, NOW).allowed).toBe(false);
  });

  it("operator подписка → allowed", () => {
    expect(checkAccess(base({ tier: "operator" }), "plan_reform", null, NOW).allowed).toBe(true);
  });
});

describe("checkAccess / plan_roadmap", () => {
  it("live_plan не достаточна → denied", () => {
    const ent = base({ purchases: [{ product: "live_plan", planId: "p1", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_roadmap", "p1", NOW).allowed).toBe(false);
  });

  it("scenario покупка → allowed", () => {
    const ent = base({ purchases: [{ product: "scenario", planId: "p1", purchasedAt: NOW }] });
    expect(checkAccess(ent, "plan_roadmap", "p1", NOW).allowed).toBe(true);
  });
});

describe("checkAccess / compliance_case", () => {
  it("0 кейсов → бесплатно", () => {
    expect(checkAccess(base(), "compliance_case", null, NOW).allowed).toBe(true);
  });

  it("1 кейс, free → denied", () => {
    const ent = base({ usage: { complianceCases: 1, taxReports: 0, planAssessRuns: 0 } });
    expect(checkAccess(ent, "compliance_case", null, NOW).allowed).toBe(false);
  });

  it("1 кейс, pulse → allowed", () => {
    const ent = base({ tier: "pulse", usage: { complianceCases: 1, taxReports: 0, planAssessRuns: 0 } });
    expect(checkAccess(ent, "compliance_case", null, NOW).allowed).toBe(true);
  });
});

describe("checkAccess / tax_report", () => {
  it("0 отчётов → бесплатно", () => {
    expect(checkAccess(base(), "tax_report", null, NOW).allowed).toBe(true);
  });

  it("1 отчёт, free → denied", () => {
    const ent = base({ usage: { complianceCases: 0, taxReports: 1, planAssessRuns: 0 } });
    expect(checkAccess(ent, "tax_report", null, NOW).allowed).toBe(false);
  });
});

// ── startTrial ────────────────────────────────────────────────────────────────

describe("startTrial", () => {
  it("первый триал → trialEndsAt через 14 дней", () => {
    const r = startTrial(base(), "pulse", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.trialEndsAt).toBe("2026-07-27T10:00:00.000Z");
    expect(r.value.tier).toBe("pulse");
  });

  it("повторный триал → ALREADY_ACCEPTED", () => {
    const ent = base({ trialEndsAt: "2026-07-20T00:00:00Z" });
    const r = startTrial(ent, "operator", NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("ALREADY_ACCEPTED");
  });

  it("исходный Entitlements не мутируется", () => {
    const ent = base();
    startTrial(ent, "pulse", NOW);
    expect(ent.trialEndsAt).toBeNull();
  });
});
