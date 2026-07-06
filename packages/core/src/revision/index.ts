/**
 * Revision module — pure functions, no I/O, no randomness.
 * Money is int kopecks throughout. All types are local until schemas/plan/revision
 * is imported via the canonical path (types are structurally identical).
 */
import type { BusinessEvent } from "@crm/schemas";
import type { HealthCheck, UploadedSource } from "@crm/schemas";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

export type AssumptionsExtracted = {
  avg_check:
    | { value: number; sampleSize: number }
    | { value: null; reason: string };
  payment_delay_days:
    | { value: number; sampleSize: number }
    | { value: null; reason: string };
  churn:
    | { value: number; sampleSize: number }
    | { value: null; reason: string };
};

export type LayerCompleteness = {
  cash: { completeness: number; sources: string[]; missingItems: string[] };
  sales: { completeness: number; sources: string[]; missingItems: string[] };
  obligations: { completeness: number; sources: string[]; missingItems: string[] };
  owner_voice: { completeness: number; sources: string[]; missingItems: string[] };
};

export type ConfidenceGateResult =
  | { verdict: "ok" }
  | { verdict: "insufficient_data"; missing: string[] };

// Re-export schema types so callers can use them from this module.
export type { HealthCheck, UploadedSource };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// 1. deriveAssumptions
// ---------------------------------------------------------------------------

export function deriveAssumptions(events: BusinessEvent[]): AssumptionsExtracted {
  // --- avg_check ---
  const paymentsIn = events.filter((e) => e.type === "payment_in") as Extract<
    BusinessEvent,
    { type: "payment_in" }
  >[];

  const avg_check: AssumptionsExtracted["avg_check"] =
    paymentsIn.length >= 3
      ? {
          value: Math.round(avg(paymentsIn.map((e) => e.amount))),
          sampleSize: paymentsIn.length,
        }
      : { value: null, reason: "insufficient_data: need ≥3 payment_in" };

  // --- payment_delay_days ---
  const stageChanges = events.filter(
    (e) => e.type === "deal_stage_changed",
  ) as Extract<BusinessEvent, { type: "deal_stage_changed" }>[];

  const matchedPayments = paymentsIn.filter((p) => p.matchedInvoiceId !== null);

  // Build map dealId → earliest deal_stage_changed ts
  const dealFirstTs = new Map<string, string>();
  for (const sc of stageChanges) {
    const existing = dealFirstTs.get(sc.dealId);
    if (!existing || sc.ts < existing) {
      dealFirstTs.set(sc.dealId, sc.ts);
    }
  }

  const delayPairs: number[] = [];
  for (const p of matchedPayments) {
    // matchedInvoiceId is used as the link; we look for a deal_stage_changed
    // whose dealId === matchedInvoiceId (spec: "find deal_stage_changed with same dealId")
    const dealTs = dealFirstTs.get(p.matchedInvoiceId!);
    if (dealTs) {
      delayPairs.push(daysBetween(dealTs.slice(0, 10), p.valueDate));
    }
  }

  const payment_delay_days: AssumptionsExtracted["payment_delay_days"] =
    delayPairs.length >= 2
      ? { value: Math.round(avg(delayPairs)), sampleSize: delayPairs.length }
      : { value: null, reason: "insufficient_data: need ≥2 matched pairs" };

  // --- churn (= lost / total unique deals) ---
  const uniqueDeals = new Set(stageChanges.map((sc) => sc.dealId));
  const lostDeals = new Set(
    stageChanges
      .filter((sc) => sc.toStage.toLowerCase() === "lost")
      .map((sc) => sc.dealId),
  );

  const churn: AssumptionsExtracted["churn"] =
    uniqueDeals.size >= 5
      ? {
          value: lostDeals.size / uniqueDeals.size,
          sampleSize: uniqueDeals.size,
        }
      : { value: null, reason: "insufficient_data: need ≥5 deals" };

  return { avg_check, payment_delay_days, churn };
}

// ---------------------------------------------------------------------------
// 2. computeHealthCheck
// ---------------------------------------------------------------------------

export function computeHealthCheck(
  events: BusinessEvent[],
  balanceKopecks: number,
): HealthCheck {
  const paymentsIn = events.filter((e) => e.type === "payment_in") as Extract<
    BusinessEvent,
    { type: "payment_in" }
  >[];
  const paymentsOut = events.filter((e) => e.type === "payment_out") as Extract<
    BusinessEvent,
    { type: "payment_out" }
  >[];

  // burn_rate: total out / months span (at least 1 month)
  let burn_rate_kopecks: number | null = null;
  if (paymentsOut.length > 0) {
    const totalOut = paymentsOut.reduce((s, e) => s + e.amount, 0);
    const dates = paymentsOut.map((e) => e.valueDate).sort();
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    const spanDays = Math.max(daysBetween(first, last), 1);
    const months = spanDays / 30;
    burn_rate_kopecks = Math.round(totalOut / months);
  }

  const runway_days: number | null =
    burn_rate_kopecks !== null && burn_rate_kopecks > 0
      ? Math.floor(balanceKopecks / (burn_rate_kopecks / 30))
      : null;

  // top_counterparties
  const totalRevenue = paymentsIn.reduce((s, e) => s + e.amount, 0);
  const byName = new Map<string, { inn: string | null; total: number }>();
  for (const p of paymentsIn) {
    const cur = byName.get(p.counterpartyName) ?? {
      inn: p.counterpartyInn,
      total: 0,
    };
    cur.total += p.amount;
    byName.set(p.counterpartyName, cur);
  }

  const sorted = [...byName.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  const top_counterparties = sorted.map(([name, { inn, total }]) => ({
    inn,
    name,
    totalKopecks: total,
    shareOfRevenue: totalRevenue > 0 ? total / totalRevenue : 0,
  }));

  const concentration_risk: number | null =
    top_counterparties.length > 0
      ? Math.max(...top_counterparties.map((c) => c.shareOfRevenue))
      : null;

  const red_flags: string[] = [];
  if (concentration_risk !== null && concentration_risk > 0.3) {
    const top = top_counterparties.find(
      (c) => c.shareOfRevenue === concentration_risk,
    )!;
    red_flags.push(`concentration: ${top.name} >30% revenue`);
  }

  return {
    runway_days,
    burn_rate_kopecks,
    top_counterparties,
    concentration_risk,
    red_flags,
  };
}

// ---------------------------------------------------------------------------
// 3. computeLayerCompleteness
// ---------------------------------------------------------------------------

export function computeLayerCompleteness(
  sources: UploadedSource[],
): LayerCompleteness {
  function layer(
    kinds: UploadedSource["kind"][],
    missingLabel: string,
  ): LayerCompleteness["cash"] {
    const matched = sources.filter((s) => (kinds as string[]).includes(s.kind));
    if (matched.length === 0) {
      return { completeness: 0, sources: [], missingItems: [missingLabel] };
    }
    return {
      completeness: avg(matched.map((s) => s.confidence)),
      sources: matched.map((s) => s.sourceId),
      missingItems: [],
    };
  }

  return {
    cash: layer(["bank_csv", "bank_pdf"], "bank_statement"),
    sales: layer(["crm_export"], "crm_data"),
    obligations: layer(["contract"], "contracts"),
    owner_voice: layer(["voice"], "owner_interview"),
  };
}

// ---------------------------------------------------------------------------
// 4. checkConfidenceGate
// ---------------------------------------------------------------------------

export function checkConfidenceGate(
  completeness: LayerCompleteness,
): ConfidenceGateResult {
  const missing: string[] = [];
  for (const layer of Object.values(completeness)) {
    if (layer.completeness < 0.9) {
      missing.push(...layer.missingItems);
    }
  }
  if (missing.length > 0) {
    return { verdict: "insufficient_data", missing };
  }
  return { verdict: "ok" };
}
