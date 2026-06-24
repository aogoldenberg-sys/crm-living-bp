import type { BusinessEvent } from "@crm/schemas";
import type {
  AbcClass,
  XyzClass,
  AbcXyzEntry,
  AbcXyzResult,
  AbcXyzInput,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ABC_A_THRESHOLD = 0.70;
const ABC_B_THRESHOLD = 0.90;

const XYZ_X_MAX_CV = 0.25;
const XYZ_Y_MAX_CV = 0.50;

const MIN_ENTITIES = 3;
const MIN_WINDOW_MONTHS = 2;
const DEFAULT_WINDOW_MONTHS = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract entity ID from a business event based on groupBy strategy.
 * Returns null when the event has no relevant entity for the strategy.
 */
function extractEntityId(
  event: BusinessEvent,
  groupBy: "client" | "product",
): string | null {
  if (groupBy === "client") {
    if (event.type === "payment_in") {
      return event.counterpartyInn ?? null;
    }
    if (event.type === "deal_stage_changed") {
      return event.counterpartyInn ?? null;
    }
    return null;
  }

  // groupBy === "product"
  if (event.type === "payment_in") {
    // Use matchedInvoiceId as product/invoice grouping key
    return event.matchedInvoiceId ?? null;
  }
  if (event.type === "deal_stage_changed") {
    // Fall back to dealId as product proxy (one deal = one product line)
    return event.dealId;
  }
  return null;
}

/**
 * Extract revenue (kopecks) from a business event.
 * Only PaymentIn and DealStageChanged contribute revenue.
 */
function extractRevenue(event: BusinessEvent): number {
  if (event.type === "payment_in") {
    return event.amount;
  }
  if (event.type === "deal_stage_changed") {
    return event.estimatedAmount ?? 0;
  }
  return 0;
}

/**
 * Parse the month key "YYYY-MM" from an ISO datetime string.
 */
function toMonthKey(ts: string): string {
  return ts.slice(0, 7); // "YYYY-MM"
}

/**
 * Parse "YYYY-MM" into a Date object (first day of month).
 */
function parseMonthKey(key: string): Date {
  return new Date(`${key}-01T00:00:00Z`);
}

/**
 * Standard deviation of an array (population stddev).
 */
function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Coefficient of variation = stddev / mean.
 * Returns 0 when mean === 0 (avoids division by zero; treat as stable).
 */
function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  return stddev(values, mean) / mean;
}

/**
 * Classify CV into XYZ class.
 */
function classifyXyz(cv: number): XyzClass {
  if (cv <= XYZ_X_MAX_CV) return "X";
  if (cv <= XYZ_Y_MAX_CV) return "Y";
  return "Z";
}

/**
 * Classify cumulative share into ABC class.
 */
function classifyAbc(cumulativeShare: number): AbcClass {
  if (cumulativeShare <= ABC_A_THRESHOLD) return "A";
  if (cumulativeShare <= ABC_B_THRESHOLD) return "B";
  return "C";
}

/**
 * Generate sorted list of month keys within the window.
 * E.g. for cutoffDate=2026-06 and windowMonths=3 → ["2026-04", "2026-05", "2026-06"]
 */
function buildMonthSlots(
  latestMonthKey: string,
  windowMonths: number,
): string[] {
  const date = parseMonthKey(latestMonthKey);
  const slots: string[] = [];
  for (let i = windowMonths - 1; i >= 0; i--) {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() - i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    slots.push(`${y}-${m}`);
  }
  return slots;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Compute ABC/XYZ analysis for clients or products.
 *
 * Returns null (confidence gate) when:
 * - Fewer than MIN_ENTITIES (3) entities have revenue
 * - windowMonths < MIN_WINDOW_MONTHS (2)
 */
export function computeAbcXyz(input: AbcXyzInput): AbcXyzResult | null {
  const windowMonths = input.windowMonths ?? DEFAULT_WINDOW_MONTHS;

  // Confidence gate: window too short
  if (windowMonths < MIN_WINDOW_MONTHS) return null;

  // Collect all revenue events keyed by entityId → monthKey → kopecks
  const entityMonthMap = new Map<string, Map<string, number>>();
  let latestTs = "";

  for (const event of input.events) {
    // Only events with a timestamp
    const ts =
      "ts" in event && typeof event.ts === "string" ? event.ts : null;
    if (!ts) continue;

    if (ts > latestTs) latestTs = ts;

    const entityId = extractEntityId(event, input.groupBy);
    if (!entityId) continue;

    const revenue = extractRevenue(event);
    if (revenue <= 0) continue;

    const monthKey = toMonthKey(ts);

    let monthMap = entityMonthMap.get(entityId);
    if (!monthMap) {
      monthMap = new Map<string, number>();
      entityMonthMap.set(entityId, monthMap);
    }

    const prev = monthMap.get(monthKey) ?? 0;
    monthMap.set(monthKey, prev + revenue);
  }

  // Confidence gate: fewer than MIN_ENTITIES entities
  if (entityMonthMap.size < MIN_ENTITIES) return null;

  // Determine month slots for XYZ window
  const latestMonthKey = latestTs.slice(0, 7);
  const monthSlots = buildMonthSlots(latestMonthKey, windowMonths);

  // Build per-entity stats
  interface EntityStats {
    entityId: string;
    totalRevenueKopecks: number;
    monthlyRevenues: number[];
  }

  const stats: EntityStats[] = [];

  for (const [entityId, monthMap] of entityMonthMap) {
    // Total revenue across ALL events (not just window)
    const totalRevenueKopecks = [...monthMap.values()].reduce(
      (s, v) => s + v,
      0,
    );

    // Monthly revenues aligned to window slots (0 for missing months)
    const monthlyRevenues = monthSlots.map((slot) => monthMap.get(slot) ?? 0);

    stats.push({ entityId, totalRevenueKopecks, monthlyRevenues });
  }

  // Sort descending by total revenue for ABC classification
  stats.sort((a, b) => b.totalRevenueKopecks - a.totalRevenueKopecks);

  const grandTotal = stats.reduce((s, e) => s + e.totalRevenueKopecks, 0);

  // Build entries with ABC classification (cumulative share)
  let cumulativeRevenue = 0;
  const entries: AbcXyzEntry[] = [];

  for (const stat of stats) {
    cumulativeRevenue += stat.totalRevenueKopecks;
    const revenueShare = grandTotal > 0 ? stat.totalRevenueKopecks / grandTotal : 0;
    const cumulativeShare = grandTotal > 0 ? cumulativeRevenue / grandTotal : 0;

    const abcClass = classifyAbc(cumulativeShare);

    const cv = coefficientOfVariation(stat.monthlyRevenues);
    const xyzClass = classifyXyz(cv);

    entries.push({
      entityId: stat.entityId,
      totalRevenueKopecks: stat.totalRevenueKopecks,
      revenueShare,
      abcClass,
      xyzClass,
      monthlyRevenues: stat.monthlyRevenues,
    });
  }

  // Build summary counts
  const allClasses: Array<`${AbcClass}${XyzClass}`> = [
    "AX", "AY", "AZ",
    "BX", "BY", "BZ",
    "CX", "CY", "CZ",
  ];
  const counts = Object.fromEntries(
    allClasses.map((k) => [k, 0]),
  ) as Record<`${AbcClass}${XyzClass}`, number>;

  for (const entry of entries) {
    const key = `${entry.abcClass}${entry.xyzClass}` as `${AbcClass}${XyzClass}`;
    counts[key] += 1;
  }

  return { entries, counts };
}
