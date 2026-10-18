import { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../firebase";

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
  _userId: string
): { orders: Order[]; loading: boolean; error: string | null } {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!businessId) return;
    attemptRef.current = 0;

    function subscribe() {
      const col = collection(db, `tenants/${businessId}/orders`);
      const q = query(col, orderBy("createdAt", "desc"));

      const unsub = onSnapshot(q, (snap) => {
        attemptRef.current = 0;
        setError(null);
        let list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) }));
        if (roleId === "assembly") {
          list = list.filter((o) => o.status === "sourcing");
        }
        setOrders(list);
        setLoading(false);
      }, (err) => {
        console.error("useOrders onSnapshot error:", err.code, err.message);
        setLoading(false);
        attemptRef.current += 1;
        const delay = Math.min(5000 * attemptRef.current, 30000);
        setError(`Ошибка соединения (${err.code}). Повтор через ${delay / 1000}с…`);
        retryRef.current = setTimeout(() => {
          unsub();
          subscribe();
        }, delay);
      });
      return unsub;
    }

    const unsub = subscribe();
    return () => {
      unsub();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [businessId, roleId]);

  return { orders, loading, error };
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

const PRICELIST_URL = "/gm-crm/pricelist.json";

export async function loadPricelist(): Promise<PlItem[]> {
  if (_plCache) return _plCache;
  if (_plLoading) return _plLoading;
  _plLoading = fetch(PRICELIST_URL)
    .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<{ items: PlItem[] }>; })
    .then((d) => { _plCache = d.items; return d.items; })
    .catch(() => { _plCache = []; _plLoading = null; return []; });
  return _plLoading;
}

function normStr(s: string): string {
  return s.toLowerCase().replace(/[^а-яёa-z0-9]/gi, " ").replace(/\s+/g, " ").trim();
}

// Возвращает Map<barcode|sku|productName → PricelistMatch[]>
export function usePricelistLookup(
  _businessId: string,
  items: OrderItem[]
): Map<string, PricelistMatch[]> {
  const [result, setResult] = useState<Map<string, PricelistMatch[]>>(new Map());

  useEffect(() => {
    if (items.length === 0) return;

    loadPricelist().then((pl) => {
      const map = new Map<string, PricelistMatch[]>();

      // Индекс по штрихкоду
      const byBarcode = new Map<string, PlItem[]>();
      for (const it of pl) {
        if (it.barcode) {
          const arr = byBarcode.get(it.barcode) ?? [];
          arr.push(it);
          byBarcode.set(it.barcode, arr);
        }
      }

      const toMatch = (it: PlItem): PricelistMatch => ({
        supplierId: it.sid,
        supplierName: it.sname,
        priceKopecks: it.price,
        barcode: it.barcode,
        productName: it.name,
      });

      for (const item of items) {
        // 1. По штрихкоду
        if (item.barcode) {
          const hits = byBarcode.get(item.barcode);
          if (hits?.length) { map.set(item.barcode, hits.map(toMatch)); continue; }
        }
        // 2. По артикулу совпадение с barcode/sku в прайсе
        if (item.productId) {
          const hits = byBarcode.get(item.productId);
          if (hits?.length) { map.set(item.productId, hits.map(toMatch)); continue; }
        }
        // 3. Keyword-поиск по названию (первые 3 значимых слова)
        const key = item.barcode ?? item.productId ?? item.productName;
        if (map.has(key)) continue;
        const words = normStr(item.productName).split(" ").filter((w) => w.length > 3).slice(0, 3);
        if (!words.length) continue;
        const hits = pl.filter((p) => words.every((w) => normStr(p.name).includes(w)));
        if (hits.length) map.set(item.productName, hits.slice(0, 5).map(toMatch));
      }

      setResult(map);
    }).catch(console.error);
  }, [items.length]);  // eslint-disable-line react-hooks/exhaustive-deps

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
