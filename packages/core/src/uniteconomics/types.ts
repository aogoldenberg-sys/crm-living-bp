import type { BusinessEvent } from "@crm/schemas";

export interface UnitEconomicsInput {
  events: BusinessEvent[];
  // number of new clients acquired (from LeadCaptured with status=qualified or DealStageChanged to first stage)
  newClients: number;
  // cost of goods sold in kopecks (PaymentOut with category matching "COGS" or "cogs" or "себестоимость")
  // if not determinable from events, pass 0 and set cogsDerived: false
  cogsDerived?: boolean;
}

export interface UnitEconomicsResult {
  // Margin
  marginKopecks: number;       // revenue - COGS, kopecks
  marginPercent: number;       // 0..1 (e.g. 0.35 = 35%)
  // ROI = (revenue - totalCosts) / totalCosts
  roi: number;                 // e.g. 1.5 = 150%
  // Payback in months: totalInvestment / monthlyNetProfit
  paybackMonths: number | null; // null if monthlyNetProfit <= 0
  // CAC = total marketing+sales spend / newClients
  cacKopecks: number | null;   // null if newClients === 0
  // LTV = avgRevenuePerClient * avgRetentionMonths (estimated from data window)
  ltvKopecks: number | null;   // null if insufficient data
  // LTV/CAC ratio
  ltvCacRatio: number | null;  // null if either is null
  // Overall health
  health: UnitHealth;
  // Data window used (months)
  dataWindowMonths: number;
}

export type UnitHealth =
  | "healthy"           // margin>20%, ROI>1.0, LTV/CAC>3
  | "warning"           // any metric borderline
  | "critical"          // margin<0 OR ROI<0
  | "insufficient_data"; // fewer than MIN_EVENTS_THRESHOLD events

export interface UnitHealthThresholds {
  marginWarnPercent: number;   // default 0.20
  roiWarn: number;             // default 1.0
  ltvCacWarn: number;          // default 3.0
  minEventsThreshold: number;  // default 10
}

export const DEFAULT_THRESHOLDS: UnitHealthThresholds = {
  marginWarnPercent: 0.20,
  roiWarn: 1.0,
  ltvCacWarn: 3.0,
  minEventsThreshold: 10,
};
