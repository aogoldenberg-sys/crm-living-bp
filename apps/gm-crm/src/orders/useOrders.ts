import { useEffect, useMemo, useState, useRef } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { useOrdersArchive, useOrdersFeed, withArchive } from "./ordersStore";

export type OrderStatus =
  | "received"
  | "approved"
  | "sourcing"
  | "invoiced"
  | "ordered"
  | "delivered"
  | "cancelled";

export type OrderSource = "napolke" | "shop" | "manual" | "import";

// Реальная схема Firestore (по данным из БД)
export interface OrderItem {
  lineId?: string;
  productId: string;
  productName: string;
  barcode?: string | null;
  quantity: number;
  qty?: number;           // алиас quantity (используется в заказах из НаПолке/магазина)
  unit?: string;          // единица измерения (шт, кг, л…)
  unitPrice: number;      // копейки за единицу
  totalKopecks: number;   // итог по позиции
  supplierId: string | null;
}

export interface Order {
  id: string;             // Firestore doc ID
  orderId?: string;
  customerName: string;
  status: OrderStatus;
  source: OrderSource;
  totalKopecks: number;   // итог заказа
  createdAt: string;
  managerId: string;
  items: OrderItem[];
  externalId?: string | null;
  customerInn?: string | null;
  paid?: boolean;
  address?: string;
  phone?: string;
  comment?: string | null;
  deliveryDate?: string;
  region?: string | null;
  assignedManager?: string | null;
  email?: string | null;
  paidAt?: string | null;
  assembledQtys?: number[];   // факт сборки по позициям, индекс = индекс items[]
  lat?: number | null;
  lng?: number | null;
}

export interface PurchaseOrder {
  id: string;
  orderIds: string[];
  supplierId: string;
  supplierName?: string;
  status: "draft" | "sent" | "confirmed" | "delivered";
  items: OrderItem[];
  expectedDate?: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function statusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    received:  "Получен",
    approved:  "Одобрен",
    sourcing:  "Закупка",
    invoiced:  "Счёт",
    ordered:   "Заказан",
    delivered: "Отгружен",
    cancelled: "Отменён",
  };
  return map[status] ?? status;
}

export function statusColor(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    received:  "#1565C0",
    approved:  "#E65100",
    sourcing:  "#6A1B9A",
    invoiced:  "#AD1457",
    ordered:   "#00695C",
    delivered: "#2E7D32",
    cancelled: "#757575",
  };
  return map[status] ?? "#757575";
}

// Добавляет N рабочих дней (пн-пт) к дате
export function addWorkDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export function deadlineTimer(fromISO: string, workDays: number): { label: string; color: string; overdue: boolean; dot: string } {
  const deadline = addWorkDays(new Date(fromISO), workDays);
  const msLeft = deadline.getTime() - Date.now();
  if (msLeft < 0) {
    const d = Math.ceil(-msLeft / 86_400_000);
    return { label: `−${d}д`, color: "#C62828", overdue: true, dot: "🔴" };
  }
  const d = Math.floor(msLeft / 86_400_000);
  if (d === 0) return { label: "сегодня", color: "#C62828", overdue: false, dot: "🔴" };
  if (d === 1) return { label: "1д", color: "#E65100", overdue: false, dot: "🟡" };
  return { label: `${d}д`, color: "#2E7D32", overdue: false, dot: "🟢" };
}

export function fmtRub(kopecks: number): string {
  if (!Number.isFinite(kopecks)) return "—";
  return (kopecks / 100).toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  });
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

type RoleId = "sales" | "assembly" | "purchasing" | "finance" | "director";

export function useOrders(
  businessId: string,
  roleId: RoleId,
  _userId: string,
  opts?: { archive?: boolean },
): { orders: Order[]; loading: boolean; error: string | null } {
  // РЕШЕНИЕ: «Сводная» и «Финансы» считают выручку по истории (paidAt старых заказов),
  // поэтому по умолчанию получают архив. Остальным — только живое окно. Скажи если не так.
  const archive = opts?.archive ?? (roleId === "director" || roleId === "finance");
  const feed = useOrdersFeed(businessId);
  const arch = useOrdersArchive(businessId, archive, feed.archiveRev);
  const orders = useMemo(() => {
    const list = arch ? withArchive(feed.orders, arch) : feed.orders;
    return roleId === "assembly" ? list.filter((o) => o.status === "sourcing") : list;
  }, [feed.orders, arch, roleId]);
  return { orders, loading: feed.loading || (archive && !arch), error: feed.error };
}

export interface PricelistMatch {
  supplierId: string;
  supplierName: string;
  priceKopecks: number | null;
  barcode: string | null;
  productName: string;
}

// ── Pricelist JSON (загружается один раз, хранится в памяти) ─────────────────

interface PlItem {
  sid: string; sname: string; name: string;
  barcode: string | null; sku: string | null;
  price: number; quant: number | null; note: string | null;
}

let _plCache: PlItem[] | null = null;
let _plLoading: Promise<PlItem[]> | null = null;

// BASE_URL = '/gm-crm/' в прод-сборке (vite base), '/' в dev.
const PRICELIST_URL = `${import.meta.env.BASE_URL}pricelist.json`;

export async function loadPricelist(): Promise<PlItem[]> {
  if (_plCache) return _plCache;
  if (_plLoading) return _plLoading;
  _plLoading = fetch(PRICELIST_URL)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ items: PlItem[] }>; })
    .then((d) => {
      if (!d || !Array.isArray(d.items)) throw new Error("неверный формат pricelist.json (нет items[])");
      _plCache = d.items;
      _plLoading = null;
      return d.items;
    })
    .catch((e: unknown) => {
      // Не кэшируем пустой результат: следующий вызов повторит загрузку.
      console.warn(`loadPricelist: не удалось загрузить ${PRICELIST_URL}:`, e);
      _plLoading = null;
      return [] as PlItem[];
    });
  return _plLoading;
}

/** Только для тестов: сброс in-memory кэша прайса. */
export function _resetPricelistCache(): void {
  _plCache = null;
  _plLoading = null;
}

function normStr(s: string): string {
  return s.toLowerCase().replace(/[^а-яёa-z0-9]/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Канонический ключ штрихкода/артикула для сравнения.
 * - number и string приводятся к строке без потери разрядов (4.6e12 → "4600000000000");
 * - убираются пробелы, NBSP, дефисы, хвост ".0" (Google Sheets / Excel);
 * - научная нотация в строке ("4,6E+12", "4.607007729208e12") разворачивается;
 * - для цифровых кодов отбрасываются ведущие нули: EAN-13 "0012345678905",
 *   UPC-12 "012345678905" и GTIN-14 "00012345678905" дают один ключ;
 * - нецифровой артикул — trim + upper-case без пробелов.
 * Возвращает null для пустых значений.
 */
export function normalizeBarcode(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    s = Number.isInteger(v) ? v.toFixed(0) : String(v);
  } else if (typeof v === "string") {
    s = v;
  } else {
    return null;
  }
  s = s.replace(/[\s\u00A0\u202F'’-]/g, "").trim();
  if (!s) return null;
  // Научная нотация из таблиц: 4.6e12, 4,6E+12
  if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s.replace(",", "."));
    if (Number.isFinite(n) && n > 0) s = Math.round(n).toFixed(0);
  }
  // Хвост ".0" / ",00" у числа, выгруженного как float
  const m = /^(\d+)[.,]0+$/.exec(s);
  if (m) s = m[1];
  if (/^\d+$/.test(s)) {
    const t = s.replace(/^0+/, "");
    return t || null;
  }
  return s.toUpperCase();
}

const toMatch = (it: PlItem): PricelistMatch => ({
  supplierId: it.sid,
  supplierName: it.sname,
  priceKopecks: it.price,
  barcode: it.barcode == null ? null : String(it.barcode),
  productName: it.name,
});

/**
 * Чистая функция подбора (вынесена из usePricelistLookup для тестов).
 * Результат кладётся под ВСЕМИ ключами позиции — сырой barcode, нормализованный
 * barcode, productId и productName, — потому что потребители (PurchasingView)
 * читают lookup.get(item.barcode) ?? lookup.get(item.productName).
 */
export function buildPricelistLookup(pl: PlItem[], items: OrderItem[]): Map<string, PricelistMatch[]> {
  const map = new Map<string, PricelistMatch[]>();

  // Индексы по нормализованному штрихкоду и артикулу (sku)
  const byBarcode = new Map<string, PlItem[]>();
  const bySku = new Map<string, PlItem[]>();
  const push = (idx: Map<string, PlItem[]>, k: string | null, it: PlItem) => {
    if (!k) return;
    const arr = idx.get(k);
    if (arr) arr.push(it); else idx.set(k, [it]);
  };
  for (const it of pl) {
    push(byBarcode, normalizeBarcode(it.barcode), it);
    push(bySku, normalizeBarcode(it.sku), it);
  }
  const findCode = (raw: unknown): PlItem[] | undefined => {
    const k = normalizeBarcode(raw);
    if (!k) return undefined;
    return byBarcode.get(k) ?? bySku.get(k);
  };

  const setAll = (item: OrderItem, matches: PricelistMatch[]) => {
    const keys = new Set<string>();
    const rawBc = item.barcode as unknown;
    if (rawBc !== null && rawBc !== undefined && rawBc !== "") keys.add(String(rawBc));
    const nb = normalizeBarcode(rawBc);
    if (nb) keys.add(nb);
    if (item.productId) keys.add(String(item.productId));
    if (item.productName) keys.add(item.productName);
    for (const k of keys) if (!map.has(k)) map.set(k, matches);
    // На случай, если barcode в Firestore хранится числом: get(number) тоже должен работать
    if (typeof rawBc === "number" && !map.has(rawBc as unknown as string)) {
      map.set(rawBc as unknown as string, matches);
    }
  };

  for (const item of items) {
    // 1. По штрихкоду
    let hits = findCode(item.barcode);
    // 2. Запасной вариант: productId сравнивается со штрихкодом/артикулом прайса
    if (!hits?.length) hits = findCode(item.productId);
    if (hits?.length) { setAll(item, hits.map(toMatch)); continue; }

    // 3. Keyword-поиск по названию (первые 3 значимых слова)
    if (!item.productName) continue;
    const words = normStr(item.productName).split(" ").filter((w) => w.length > 3).slice(0, 3);
    if (!words.length) continue;
    const nameHits = pl.filter((p) => p.name && words.every((w) => normStr(p.name).includes(w)));
    if (nameHits.length) setAll(item, nameHits.slice(0, 5).map(toMatch));
  }
  return map;
}

// Возвращает Map<barcode|productId|productName → PricelistMatch[]>
export function usePricelistLookup(
  _businessId: string,
  items: OrderItem[]
): Map<string, PricelistMatch[]> {
  const [result, setResult] = useState<Map<string, PricelistMatch[]>>(new Map());

  // Стабильный ключ состава позиций: пересчёт при замене товара даже при том же количестве
  const itemsKey = items
    .map((i) => `${i.barcode ?? ""}\u0001${i.productId ?? ""}\u0001${i.productName ?? ""}`)
    .join("\u0002");
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const current = itemsRef.current;
    if (current.length === 0) {
      setResult((prev) => (prev.size ? new Map() : prev));
      return;
    }
    let cancelled = false;
    loadPricelist().then((pl) => {
      if (cancelled) return; // устаревший результат: размонтирован или items сменились
      setResult(buildPricelistLookup(pl, current));
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [itemsKey]);

  return result;
}

export function usePurchaseOrders(
  businessId: string
): { purchaseOrders: PurchaseOrder[]; loading: boolean } {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, `tenants/${businessId}/purchase_orders`),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPurchaseOrders(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchaseOrder, "id">) }))
      );
      setLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  return { purchaseOrders, loading };
}
