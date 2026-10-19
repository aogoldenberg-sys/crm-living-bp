// Чистая логика склада и отгрузки (без React/Firebase) — покрыта stockOps.test.ts.
import type { Order, OrderItem, PricelistMatch } from "./useOrders";
import { normalizeRegion, type RegionCode } from "./region";
import { itemQty, itemUnitKopecks } from "./money";

export const STOCK = "Склад";

export interface ALine {
  idx: number;
  productName: string;
  barcode: string | null;
  qtyOrdered: number;
  qtyPacked: number;
  unitSellKopecks: number;
  supplierName: string;
  supplierId: string;
  unitCostKopecks: number;
  sentToPurchase: boolean;
  replaced?: boolean;   // позиция заменена на другой товар — долг не пишется
  matches: PricelistMatch[];
}
export type SavedLine = Omit<ALine, "matches">;

export { itemQty };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ── Остатки по регионам ──────────────────────────────────────────────────────

export interface StockRow {
  productName: string;
  barcode?: string | null;
  qty: number;
  costKopecks?: number;
  region?: string | null;
}
interface Bal { qty: number; inQty: number; inCost: number }
/** Ключ: `${region}|${штрихкод или название в нижнем регистре}`. */
export type StockIndex = Map<string, Bal>;

const productKey = (r: { barcode?: string | null; productName: string }) =>
  r.barcode ? String(r.barcode) : String(r.productName ?? "").toLowerCase();

export function buildStockIndex(rows: StockRow[]): StockIndex {
  const idx: StockIndex = new Map();
  for (const r of rows) {
    const k = `${normalizeRegion(r.region)}|${productKey(r)}`;
    const b = idx.get(k) ?? { qty: 0, inQty: 0, inCost: 0 };
    b.qty = round3(b.qty + (Number(r.qty) || 0));
    if (r.qty > 0 && (r.costKopecks ?? 0) > 0) {
      b.inQty += r.qty;
      b.inCost += r.qty * (r.costKopecks ?? 0);
    }
    idx.set(k, b);
  }
  return idx;
}

function stockAt(idx: StockIndex, region: RegionCode, item: { barcode?: string | null; productName: string }): Bal | undefined {
  if (item.barcode) {
    const b = idx.get(`${region}|${String(item.barcode)}`);
    if (b) return b;
  }
  return idx.get(`${region}|${String(item.productName ?? "").toLowerCase()}`);
}

export function stockQty(idx: StockIndex, region: RegionCode, item: { barcode?: string | null; productName: string }): number {
  return stockAt(idx, region, item)?.qty ?? 0;
}

/** Средняя себестоимость прихода в регионе, целые копейки. */
export function avgCost(idx: StockIndex, region: RegionCode, item: { barcode?: string | null; productName: string }): number {
  const b = stockAt(idx, region, item);
  return b && b.inQty > 0 ? Math.round(b.inCost / b.inQty) : 0;
}

// ── Строка сборки ────────────────────────────────────────────────────────────

export function buildLine(item: OrderItem, idx: number, m: PricelistMatch[], stock: StockIndex, region: RegionCode): ALine {
  const qty = itemQty(item);
  const unitSell = itemUnitKopecks(item); // НаПолке: unitPrice бывает в рублях — цена от totalKopecks
  const base = { idx, productName: item.productName, barcode: item.barcode ?? null,
    qtyOrdered: qty, qtyPacked: 0, unitSellKopecks: unitSell, sentToPurchase: false, replaced: false, matches: m };
  // Склад — только если остатка в регионе заказа хватает на всю позицию (или менеджер явно выбрал СКЛАД)
  if (item.supplierId === "СКЛАД" || (qty > 0 && stockQty(stock, region, item) >= qty)) {
    return { ...base, supplierName: STOCK, supplierId: "stock", unitCostKopecks: avgCost(stock, region, item) };
  }
  const chosen = (item.supplierId ? m.find(x => x.supplierName === item.supplierId) : undefined) ?? m[0];
  return { ...base, supplierName: chosen?.supplierName ?? "", supplierId: chosen?.supplierId ?? "",
    unitCostKopecks: chosen?.priceKopecks ?? 0 };
}

/** Сохранённая строка приоритетнее построенной, если относится к той же позиции (или заменена вручную). */
function sameItem(prev: SavedLine, item: OrderItem): boolean {
  if (prev.replaced) return true;
  return prev.barcode && item.barcode ? String(prev.barcode) === String(item.barcode) : prev.productName === item.productName;
}

export function mergeLine(prev: SavedLine | undefined, item: OrderItem, built: ALine): ALine {
  if (!prev || !sameItem(prev, item)) return built;
  return { ...prev, qtyOrdered: prev.replaced ? prev.qtyOrdered : built.qtyOrdered, matches: built.matches };
}

// ── План отгрузки ────────────────────────────────────────────────────────────

type ShipOrder = Pick<Order, "id" | "customerName" | "assignedManager" | "deliveryDate" | "region" | "address">;

export const writeoffId = (orderId: string, idx: number) => `${orderId}_${idx}`;

export function planShipment(order: ShipOrder, lines: SavedLine[], uid: string, now: string) {
  const region = normalizeRegion(order.region, order.address);
  const stock = lines
    .filter(l => l.supplierName === STOCK && l.qtyPacked > 0)
    .map(l => ({ id: writeoffId(order.id, l.idx), data: {
      productName: l.productName, barcode: l.barcode ?? null,
      qty: -l.qtyPacked, supplierName: null, costKopecks: l.unitCostKopecks ?? 0,
      note: `Списание: ${order.customerName}`, region, orderId: order.id,
      createdAt: now, createdBy: uid,
    } }));
  const debtItems = lines
    .filter(l => !l.replaced && l.qtyOrdered > l.qtyPacked)
    .map(l => ({ productName: l.productName, barcode: l.barcode ?? null, qtyOrdered: l.qtyOrdered,
      qtyShipped: l.qtyPacked, qtyDebt: round3(l.qtyOrdered - l.qtyPacked), unitSellKopecks: l.unitSellKopecks ?? 0 }));
  const debt = debtItems.length ? {
    orderId: order.id, customerName: order.customerName,
    assignedManager: order.assignedManager ?? null, deliveryDate: order.deliveryDate ?? null,
    region: order.region ?? null, address: order.address ?? null,
    items: debtItems, createdAt: now,
  } : null;
  return { stock, debt };
}

/** paidAt + N рабочих дней по московскому календарю → "YYYY-MM-DD". */
export function addWorkDaysMsk(iso: string, days: number): string {
  const msk = new Date(new Date(iso).getTime() + 3 * 3600_000); // МСК = UTC+3 круглый год
  const d = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()));
  for (let added = 0; added < days;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}
