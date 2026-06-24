import type { BusinessEvent } from "@crm/schemas";
import type { UnitEconomicsInput, UnitEconomicsResult, UnitHealthThresholds } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

/** Parses an ISO date/datetime string and returns a Date. */
function parseDate(ts: string): Date {
  return new Date(ts);
}

/** Returns the span in months between two dates (min 0). */
function monthsBetween(a: Date, b: Date): number {
  const diffMs = Math.abs(b.getTime() - a.getTime());
  return diffMs / (1000 * 60 * 60 * 24 * 30.44);
}

function isCogsCategory(category: string): boolean {
  const c = category.toLowerCase();
  return c.includes("cogs") || c.includes("себестоимость") || c.includes("cost_of_goods");
}

function isMarketingCategory(category: string): boolean {
  const c = category.toLowerCase();
  return (
    c.includes("marketing") ||
    c.includes("маркетинг") ||
    c.includes("ads") ||
    c.includes("acquisition") ||
    c.includes("cac")
  );
}

/**
 * Main entry point. Returns insufficient_data if events.length < thresholds.minEventsThreshold.
 * Confidence gate: never returns 0 for margin/CAC/LTV when data is sparse — returns null or insufficient_data.
 */
export function computeUnitEconomics(
  input: UnitEconomicsInput,
  thresholds: UnitHealthThresholds = DEFAULT_THRESHOLDS,
): UnitEconomicsResult {
  const { events, newClients } = input;

  // Step 1: Insufficient data gate
  if (events.length < thresholds.minEventsThreshold) {
    return {
      marginKopecks: 0,
      marginPercent: 0,
      roi: 0,
      paybackMonths: null,
      cacKopecks: null,
      ltvKopecks: null,
      ltvCacRatio: null,
      health: "insufficient_data",
      dataWindowMonths: 0,
    };
  }

  // Step 2: Sum PaymentIn.amount → revenueKopecks
  let revenueKopecks = 0;
  for (const ev of events) {
    if (ev.type === "payment_in") {
      revenueKopecks += ev.amount;
    }
  }

  // Step 3: Sum PaymentOut.amount → totalCostsKopecks
  let totalCostsKopecks = 0;
  for (const ev of events) {
    if (ev.type === "payment_out") {
      totalCostsKopecks += ev.amount;
    }
  }

  // Step 4: Determine COGS from PaymentOut expenseCategory
  let cogsKopecks = 0;
  for (const ev of events) {
    if (ev.type === "payment_out" && isCogsCategory(ev.expenseCategory)) {
      cogsKopecks += ev.amount;
    }
  }

  // Step 5: marginKopecks
  const marginKopecks = revenueKopecks - cogsKopecks;

  // Step 6: marginPercent
  const marginPercent = revenueKopecks > 0 ? marginKopecks / revenueKopecks : 0;

  // Step 7: ROI
  const roi =
    totalCostsKopecks > 0
      ? (revenueKopecks - totalCostsKopecks) / totalCostsKopecks
      : 0;

  // Step 8: Data window from event timestamps
  const dates: Date[] = [];
  for (const ev of events) {
    if ("ts" in ev && typeof ev.ts === "string") {
      dates.push(parseDate(ev.ts));
    }
  }

  let dataWindowMonths = 0;
  if (dates.length >= 2) {
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    dataWindowMonths = monthsBetween(minDate, maxDate);
  }

  // Step 9: paybackMonths
  let paybackMonths: number | null = null;
  if (dataWindowMonths > 0) {
    const monthlyNet = (revenueKopecks - totalCostsKopecks) / dataWindowMonths;
    if (monthlyNet > 0) {
      paybackMonths = totalCostsKopecks / monthlyNet;
    }
  }

  // Step 10: CAC
  let cacKopecks: number | null = null;
  if (newClients > 0) {
    let marketingSpend = 0;
    for (const ev of events) {
      if (ev.type === "payment_out" && isMarketingCategory(ev.expenseCategory)) {
        marketingSpend += ev.amount;
      }
    }
    cacKopecks = marketingSpend / newClients;
  }

  // Step 11: LTV
  let ltvKopecks: number | null = null;
  if (newClients > 0 && dataWindowMonths > 0) {
    const avgRevPerClient = revenueKopecks / newClients;
    const avgRetentionMonths = dataWindowMonths;
    ltvKopecks = avgRevPerClient * avgRetentionMonths;
  }

  // Step 12: LTV/CAC ratio
  let ltvCacRatio: number | null = null;
  if (ltvKopecks !== null && cacKopecks !== null && cacKopecks > 0) {
    ltvCacRatio = ltvKopecks / cacKopecks;
  }

  // Step 13: Health
  let health: UnitEconomicsResult["health"];
  if (marginPercent < 0 || roi < 0) {
    health = "critical";
  } else if (
    marginPercent < thresholds.marginWarnPercent ||
    roi < thresholds.roiWarn ||
    (ltvCacRatio !== null && ltvCacRatio < thresholds.ltvCacWarn)
  ) {
    health = "warning";
  } else {
    health = "healthy";
  }

  return {
    marginKopecks,
    marginPercent,
    roi,
    paybackMonths,
    cacKopecks,
    ltvKopecks,
    ltvCacRatio,
    health,
    dataWindowMonths,
  };
}
