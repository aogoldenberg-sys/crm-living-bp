import type { Entitlements, PlanTier } from "@crm/schemas";

export type BillingAction =
  | "plan_assess"
  | "plan_reform"
  | "plan_roadmap"
  | "grant_adapt"
  | "compliance_case"
  | "tax_report";

export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason: string; requiredProduct?: string; requiredTier?: string };

const TIER_RANK: Record<PlanTier, number> = {
  free: 0, pulse: 1, operator: 2, director: 3, enterprise: 4,
};

const PRODUCT_RANK: Record<string, number> = {
  diag: 0, live_plan: 1, scenario: 2, subsidy: 3, grant_pro: 4,
};

function tierRank(ent: Entitlements, now: string): number {
  // Backward compat: old plan:"paid" + valid paidUntil → operator level
  if (ent.plan === "paid" && ent.paidUntil && now <= ent.paidUntil + "T23:59:59Z") {
    return Math.max(TIER_RANK[ent.tier], TIER_RANK.operator);
  }
  return TIER_RANK[ent.tier];
}

function trialActive(ent: Entitlements, now: string): boolean {
  return ent.trialEndsAt != null && now <= ent.trialEndsAt;
}

const PR = PRODUCT_RANK;

function hasPurchase(ent: Entitlements, planId: string, minRank: number): boolean {
  return ent.purchases.some(
    p => p.planId === planId && (PR[p.product] ?? -1) >= minRank,
  );
}

/**
 * Чистая функция — нет побочных эффектов, нет I/O.
 * planId нужен только для plan_X и grant_X действий; для compliance/tax передать null.
 */
export function checkAccess(
  ent: Entitlements,
  action: BillingAction,
  planId: string | null,
  now: string,
): AccessResult {
  if (ent.internal === true) return { allowed: true };

  const rank = tierRank(ent, now);
  const trial = trialActive(ent, now);

  switch (action) {
    case "plan_assess": {
      if (trial || rank >= TIER_RANK.pulse) return { allowed: true };
      if (planId && hasPurchase(ent, planId, PR.diag ?? 0)) return { allowed: true };
      return { allowed: false, reason: "Требуется покупка «Диагностика» или подписка «Пульс»", requiredProduct: "diag" };
    }
    case "plan_reform": {
      if (trial || rank >= TIER_RANK.operator) return { allowed: true };
      if (planId && hasPurchase(ent, planId, PR.live_plan ?? 1)) return { allowed: true };
      return { allowed: false, reason: "Требуется «Живой план» или подписка «Операционист»", requiredProduct: "live_plan", requiredTier: "operator" };
    }
    case "plan_roadmap": {
      if (trial || rank >= TIER_RANK.operator) return { allowed: true };
      if (planId && hasPurchase(ent, planId, PR.scenario ?? 2)) return { allowed: true };
      return { allowed: false, reason: "Требуется «Сценарий» или подписка «Операционист»", requiredProduct: "scenario", requiredTier: "operator" };
    }
    case "grant_adapt": {
      if (trial || rank >= TIER_RANK.operator) return { allowed: true };
      if (planId && hasPurchase(ent, planId, PR.subsidy ?? 3)) return { allowed: true };
      return { allowed: false, reason: "Требуется «Под субсидию» или подписка «Операционист»", requiredProduct: "subsidy", requiredTier: "operator" };
    }
    case "compliance_case": {
      if (ent.usage.complianceCases === 0) return { allowed: true };
      if (trial || rank >= TIER_RANK.pulse) return { allowed: true };
      return { allowed: false, reason: "Бесплатный кейс использован. Подключите «Пульс».", requiredTier: "pulse" };
    }
    case "tax_report": {
      if (ent.usage.taxReports === 0) return { allowed: true };
      if (trial || rank >= TIER_RANK.pulse) return { allowed: true };
      return { allowed: false, reason: "Бесплатный отчёт использован. Подключите «Пульс».", requiredTier: "pulse" };
    }
  }
}
