import { describe, it, expect } from "vitest";
import { Entitlements, PlanTier, OneOffProduct, OneOffPurchase, UsageCounters } from "./entitlements.js";

const BASE = {
  businessId: "biz1",
  plan: "free" as const,
  paidUntil: null,
  freeComplianceUsed: false,
  freeReportUsed: false,
  updatedAt: "2026-07-13T00:00:00Z",
};

describe("Entitlements", () => {
  it("старый документ без новых полей — парсится с defaults", () => {
    const r = Entitlements.safeParse(BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tier).toBe("free");
    expect(r.data.trialEndsAt).toBeNull();
    expect(r.data.purchases).toEqual([]);
    expect(r.data.usage.complianceCases).toBe(0);
  });

  it("полный новый документ — парсится", () => {
    const r = Entitlements.safeParse({
      ...BASE,
      tier: "operator",
      trialEndsAt: "2026-08-01T00:00:00Z",
      purchases: [{ product: "diag", planId: "p1", purchasedAt: "2026-07-01T00:00:00Z" }],
      usage: { complianceCases: 1, taxReports: 0, planAssessRuns: 3 },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tier).toBe("operator");
    expect(r.data.purchases).toHaveLength(1);
  });

  it("неверный tier — ошибка", () => {
    const r = Entitlements.safeParse({ ...BASE, tier: "unknown" });
    expect(r.success).toBe(false);
  });

  it("лишнее поле в strict режиме — ошибка", () => {
    const r = Entitlements.safeParse({ ...BASE, extraField: true });
    expect(r.success).toBe(false);
  });

  it("отрицательный счётчик — ошибка", () => {
    const r = UsageCounters.safeParse({ complianceCases: -1, taxReports: 0, planAssessRuns: 0 });
    expect(r.success).toBe(false);
  });

  it("PlanTier содержит все 5 вариантов", () => {
    const tiers = ["free", "pulse", "operator", "director", "enterprise"] as const;
    for (const t of tiers) {
      expect(PlanTier.safeParse(t).success).toBe(true);
    }
  });

  it("OneOffProduct содержит все 5 продуктов", () => {
    for (const p of ["diag", "live_plan", "scenario", "subsidy", "grant_pro"] as const) {
      expect(OneOffProduct.safeParse(p).success).toBe(true);
    }
  });

  it("покупка без planId — ошибка", () => {
    const r = OneOffPurchase.safeParse({ product: "diag", planId: "", purchasedAt: "2026-07-01T00:00:00Z" });
    expect(r.success).toBe(false);
  });
});
