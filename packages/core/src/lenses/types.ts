import type { BusinessEvent } from "@crm/schemas";

// ── ABC/XYZ types ─────────────────────────────────────────────────────────────

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

export interface AbcXyzEntry {
  entityId: string;
  totalRevenueKopecks: number;
  revenueShare: number; // 0..1
  abcClass: AbcClass;
  xyzClass: XyzClass;
  /** Revenue per month in chronological order, kopecks */
  monthlyRevenues: number[];
}

export interface AbcXyzResult {
  entries: AbcXyzEntry[];
  counts: Record<`${AbcClass}${XyzClass}`, number>;
}

export interface AbcXyzInput {
  events: BusinessEvent[];
  /**
   * "client" — groups by counterpartyInn (PaymentIn, DealStageChanged)
   * "product" — groups by matchedInvoiceId (PaymentIn only) when available,
   *             falls back to dealId (DealStageChanged)
   */
  groupBy: "client" | "product";
  /** Data window for XYZ: months back from most recent event date. Default 6. */
  windowMonths?: number;
}

// ── SWOT types ────────────────────────────────────────────────────────────────

export interface SwotItem {
  signal: string;
  detail?: string;
  source: string;
}

export interface SwotStructure {
  strengths: SwotItem[];
  weaknesses: SwotItem[];
  /** Stubs — populated by §11 */
  opportunities: SwotItem[];
  /** Stubs — populated by §11 */
  threats: SwotItem[];
}

export interface SwotInput {
  revenueGrowthRate?: number;       // MoM, e.g. 0.15 = 15%
  marginPercent?: number;           // 0..1
  topClientConcentration?: number;  // share of top-3 clients, 0..1
  dealVelocityDays?: number;        // avg days to close
  ltvCacRatio?: number;
  paybackMonths?: number | null;
}
