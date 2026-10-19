// ── Сводная директора: чистый расчёт (покрыт тестами directorStats.test.ts) ──
import { normalizeRegion, type RegionCode } from "./region";

export interface StatOrder {
  id: string;
  status: string;
  totalKopecks: number;
  region?: string | null;
  address?: string | null;
  paid?: boolean;
  paidAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deliveredAt?: unknown;
}

export interface CostLine { qtyPacked?: number; unitCostKopecks?: number }

export interface RegionStats {
  revenue: number;        // коп., оплаченные в месяце (по paidAt)
  paidCount: number;
  profit: number | null;  // коп., только по заказам с известной себестоимостью; null — нет ни одного
  costedRevenue: number;  // выручка заказов с известной себестоимостью (база для маржи)
  noCostCount: number;    // оплаченных в месяце без себестоимости
  shipped: number;        // коп., отгружено в месяце (по deliveredAt)
  shippedCount: number;
}

/** createdAt и др. приходят из Firestore как Timestamp или ISO-строка. */
export function toDate(v: unknown): Date | null {
  if (typeof v === "string" && v) { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  if (v instanceof Date) return v;
  if (v && typeof v === "object" && "toDate" in v) return (v as { toDate(): Date }).toDate();
  return null;
}

function sameMonth(v: unknown, now: Date): boolean {
  const d = toDate(v);
  return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/**
 * Себестоимость заказа, коп.: сборка (qtyPacked × unitCostKopecks), если у всех собранных строк
 * она есть; иначе purchase_lines; иначе null («нет данных», а не прибыль 100%).
 */
export function orderCost(lines: CostLine[] | undefined, purchaseCost: number | undefined): number | null {
  const packed = (lines ?? []).filter((l) => (l.qtyPacked ?? 0) > 0);
  if (packed.length && packed.every((l) => (l.unitCostKopecks ?? 0) > 0)) {
    return Math.round(packed.reduce((s, l) => s + l.qtyPacked! * l.unitCostKopecks!, 0));
  }
  return purchaseCost && purchaseCost > 0 ? purchaseCost : null;
}

function emptyStats(): RegionStats {
  return { revenue: 0, paidCount: 0, profit: null, costedRevenue: 0, noCostCount: 0, shipped: 0, shippedCount: 0 };
}

export function directorStats(
  orders: StatOrder[],
  costOf: (orderId: string) => number | null,
  now: Date,
): Record<RegionCode, RegionStats> {
  const res: Record<RegionCode, RegionStats> = { msk: emptyStats(), spb: emptyStats() };
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const r = res[normalizeRegion(o.region, o.address)];
    const total = o.totalKopecks ?? 0;

    // Выручка по деньгам — как в FinanceView: оплачен, дата оплаты (старые без paidAt — createdAt)
    if (o.paid && sameMonth(o.paidAt || o.createdAt, now)) {
      r.revenue += total;
      r.paidCount++;
      const cost = costOf(o.id);
      if (cost === null) r.noCostCount++;
      else {
        r.profit = (r.profit ?? 0) + total - cost;
        r.costedRevenue += total;
      }
    }
    if (o.status === "delivered" && sameMonth(o.deliveredAt ?? o.updatedAt ?? o.createdAt, now)) {
      r.shipped += total;
      r.shippedCount++;
    }
  }
  return res;
}
