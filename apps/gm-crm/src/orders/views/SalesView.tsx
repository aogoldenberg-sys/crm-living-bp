import { useState, useRef, useEffect } from "react";
import { collection, addDoc, updateDoc, doc, setDoc, onSnapshot, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import {
  useOrders, statusLabel, statusColor, fmtRub, deadlineTimer,
  type OrderStatus, type OrderSource, type Order,
} from "../useOrders";
import catalog from "../suppliersCatalog.json";
import { InvoiceModal } from "./InvoiceModal";
import { ItemPickerModal, type PickedItem } from "./ItemPickerModal";
import { UpdModal, type UpdItem } from "./UpdModal";
import { PhoneButton } from "../../telephony/PhoneButton";
import { findExtension } from "../../telephony/config";
import "../orders.css";

interface Props {
  businessId: string;
  onGoToPurchasing: (clientName: string) => void;
  onGoToAssembly?: (orderId: string) => void;
  readonlyManager?: boolean;
  regionFilter?: string;
}

const SOURCE_LABELS: Record<OrderSource, string> = {
  napolke: "НаПолке", shop: "Магазин", manual: "Вручную", import: "Импорт",
};

const NEXT_ACTIONS: Partial<Record<OrderStatus, { label: string; status: OrderStatus; color: string }[]>> = {
  received:  [{ label: "Одобрить", status: "approved",  color: "#E65100" }, { label: "Отменить", status: "cancelled", color: "#757575" }],
  approved:  [{ label: "В сборку", status: "sourcing",  color: "#6A1B9A" }, { label: "Счёт ✉", status: "invoiced", color: "#AD1457" }, { label: "Отменить", status: "cancelled", color: "#757575" }],
  sourcing:  [{ label: "Счёт ✉", status: "invoiced", color: "#AD1457" }, { label: "Отменить", status: "cancelled", color: "#757575" }],
  invoiced:  [{ label: "Отменить", status: "cancelled", color: "#757575" }],
  delivered: [{ label: "↩ Не отгружен", status: "sourcing", color: "#6A1B9A" }],
  cancelled: [{ label: "Одобрить", status: "approved",  color: "#E65100" }],
};

const MANAGERS = ["Марина", "Ольга", "Анна"];

const COL_NAMES = ["№", "Дата", "Отгрузка", "Клиент", "Менеджер", "Телефон", "Город", "Поз.", "Сумма", "Статус", "Действие"];
const COL_DEFAULTS = [90, 78, 100, 200, 90, 110, 85, 48, 88, 90, 210];

// Группа для сортировки: 0 = активные, 1 = сборка, 2 = завершённые
const STATUS_GROUP: Record<OrderStatus, number> = {
  received: 0, approved: 0,
  sourcing: 1, invoiced: 1, ordered: 1,
  delivered: 2, cancelled: 2,
};

const STATUS_ROW_BG: Partial<Record<string, string>> = {
  cancelled:      "rgba(0,0,0,.04)",
  approved:       "rgba(46,125,50,.07)",
  sourcing:       "rgba(156,39,176,.18)",   // ярко-сиреневый — сборка
  delivered:      "rgba(21,101,192,.20)",   // ярко-синий — на доставку
  paid:           "rgba(46,175,80,.22)",    // ярко-зелёный — оплачено
};
const LS_KEY = "gustoriko_order_col_widths";

function loadWidths(): number[] {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const arr = JSON.parse(s) as number[];
      if (arr.length === COL_DEFAULTS.length) return arr;
    }
  } catch { /* ignore */ }
  return COL_DEFAULTS;
}

const SUPPLIER_OPTIONS = [
  { id: "СКЛАД", label: "СКЛАД" },
  ...(catalog as { cat: string; icon: string; suppliers: { name: string }[] }[])
    .flatMap((g) => g.suppliers.map((s) => ({ id: s.name, label: s.name }))),
];

function extractCity(address?: string | null, region?: string | null): string {
  if (address) {
    const m = address.match(/г\.?\s*([А-ЯЁа-яё][А-ЯЁа-яё\-]+)/u);
    if (m?.[1]) return m[1];
    const first = address.split(",")[0].trim();
    return first.length <= 22 ? first : first.slice(0, 20) + "…";
  }
  if (region) return region.replace(/\s*(обл\.|обл|область|край|республика|р-н).*/i, "").trim();
  return "—";
}

function calcProgress(items: Order["items"], actuals: number[]): number {
  const total = items.reduce((s, it) => s + it.quantity, 0);
  if (total === 0) return 0;
  return Math.round(items.reduce((s, it, i) => s + Math.min(actuals[i] ?? 0, it.quantity), 0) / total * 100);
}


export function SalesView({ businessId, onGoToPurchasing: _onGoToPurchasing, onGoToAssembly, readonlyManager = false, regionFilter }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading, error: ordersError } = useOrders(businessId, "sales", uid);

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actualQtys, setActualQtys] = useState<Record<string, number[]>>({});
  const [assemblySuppliers, setAssemblySuppliers] = useState<Record<string, string[]>>({});
  const [dirtyOrders, setDirtyOrders] = useState<Set<string>>(new Set());
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [source, setSource] = useState<OrderSource>("manual");
  const [newOrderItems, setNewOrderItems] = useState<PickedItem[]>([]);
  const [showNewItemPicker, setShowNewItemPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [sortCol, setSortCol] = useState<"date" | "delivery" | "sum" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sortMode, setSortMode] = useState<"status" | "date">("status");
  const [commentEdits, setCommentEdits] = useState<Record<string, string>>({});
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [updOrder, setUpdOrder] = useState<Order | null>(null);
  const [editItem, setEditItem] = useState<{ order: Order; idx: number | null } | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(loadWidths);
  const widthsRef = useRef(colWidths);
  widthsRef.current = colWidths;
  const actualQtysRef = useRef<Record<string, number[]>>({});
  actualQtysRef.current = actualQtys;
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Тик каждую минуту — обновляет таймеры дедлайна
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60_000); return () => clearInterval(t); }, []);

  // Realtime: факт + поставщиков из assembly-коллекции
  useEffect(() => {
    if (!businessId) return;
    const col = collection(db, `tenants/${businessId}/assembly`);
    return onSnapshot(col, (snap) => {
      const nextQtys: Record<string, number[]> = {};
      const nextSuppliers: Record<string, string[]> = {};
      for (const d of snap.docs) {
        const data = d.data() as { qtys?: number[]; lines?: { idx: number; qtyPacked: number; supplierName?: string }[] };
        nextQtys[d.id] = data.qtys
          ? data.qtys.map(v => v ?? 0)
          : (data.lines ?? []).reduce<number[]>((arr, l) => { arr[l.idx] = l.qtyPacked ?? 0; return arr; }, []);
        const sn = (data.lines ?? []).reduce<string[]>((arr, l) => {
          if (l.supplierName) arr[l.idx] = l.supplierName;
          return arr;
        }, []);
        if (sn.some(Boolean)) nextSuppliers[d.id] = sn;
      }
      setActualQtys(nextQtys);
      setAssemblySuppliers(nextSuppliers);
    });
  }, [businessId]);

  function startResize(idx: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthsRef.current[idx];
    const handle = e.currentTarget as HTMLElement;
    handle.classList.add("dragging");

    const move = (ev: MouseEvent) => {
      const newW = Math.max(36, startW + ev.clientX - startX);
      widthsRef.current = [...widthsRef.current];
      widthsRef.current[idx] = newW;
      setColWidths([...widthsRef.current]);
    };
    const up = () => {
      handle.classList.remove("dragging");
      localStorage.setItem(LS_KEY, JSON.stringify(widthsRef.current));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  const now = new Date();
  // regionFilter: если задан — показываем заказы с region-тегом ИЛИ с СПб в адресе
  const regionOrders = regionFilter ? orders.filter((o) => {
    if (o.region === regionFilter) return true;
    if (regionFilter === "spb") {
      const a = (o.address ?? "").toLowerCase();
      return a.includes("санкт-петербург") || a.includes("петербург") || a.includes("с.-петербург") || a.includes("спб") || a.includes("ленинградская");
    }
    return false;
  }) : orders;
  const monthOrders = regionOrders.filter((o) => {
    if (o.status === "cancelled") return false;
    const d = new Date(o.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const cntPaid      = monthOrders.filter((o) => o.paid).length;
  const cntAssembly  = regionOrders.filter((o) => o.status === "sourcing").length;
  const cntShipped   = regionOrders.filter((o) => o.status === "delivered").length;
  const cntDebt      = regionOrders.filter((o) => {
    if (o.status === "cancelled" || o.status === "delivered") return false;
    return (o.assembledQtys ?? []).some((q: number) => q > 0);
  }).length;

  // Unique cities for filter dropdown
  const cities = [...new Set(
    regionOrders.map((o) => extractCity(o.address, o.region)).filter((c) => c !== "—")
  )].sort();

  const q = search.trim().toLowerCase();
  const filtered = regionOrders
    .filter((o) => {
      if (q && !o.customerName.toLowerCase().includes(q) && !(o.externalId ?? "").toLowerCase().includes(q)) return false;
      if (filterDateFrom && o.createdAt < filterDateFrom) return false;
      if (filterDateTo && o.createdAt > filterDateTo + "T23:59:59") return false;
      if (filterCity && extractCity(o.address, o.region) !== filterCity) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortCol) {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortCol === "date") return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (sortCol === "delivery") {
          const da = a.deliveryDate ? new Date(a.deliveryDate).getTime() : Infinity;
          const db2 = b.deliveryDate ? new Date(b.deliveryDate).getTime() : Infinity;
          return dir * (da - db2);
        }
        if (sortCol === "sum") return dir * (a.totalKopecks - b.totalKopecks);
      }
      if (sortMode === "status") {
        const ga = STATUS_GROUP[a.status] ?? 3;
        const gb = STATUS_GROUP[b.status] ?? 3;
        if (ga !== gb) return ga - gb;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  async function changeStatus(order: Order, status: OrderStatus) {
    setUpdatingId(order.id);
    try {
      await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { status, updatedAt: new Date().toISOString() });
      if (status === "cancelled" || status === "delivered") {
        const plCol = collection(db, `tenants/${businessId}/purchase_lines`);
        const snap = await getDocs(query(plCol, where("orderId", "==", order.id)));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      }
      // Уведомление клиентам — временно отключено
      // if (order.email) {
      //   void fetch("https://opentgp.ru/food/pay-proxy.php", {
      //     method: "POST",
      //     headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-notify" },
      //     body: JSON.stringify({ email: order.email, customerName: order.customerName, orderId: order.id, status, statusLabel: statusLabel(status) }),
      //   });
      // }
    } catch (e) {
      alert("Ошибка смены статуса: " + String(e));
    }
    setUpdatingId(null);
  }

  async function deliverFromSales(order: Order) {
    setUpdatingId(order.id);
    try {
      const qtys = actualQtysRef.current[order.id] ?? [];
      const debtItems = order.items
        .map((it, i) => ({ it, shipped: Math.min(qtys[i] ?? 0, it.quantity) }))
        .filter(({ it, shipped }) => shipped < it.quantity)
        .map(({ it, shipped }) => ({
          productName: it.productName, barcode: it.barcode ?? null,
          qtyOrdered: it.quantity, qtyShipped: shipped,
          qtyDebt: it.quantity - shipped, unitSellKopecks: it.unitPrice,
        }));
      await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), {
        status: "delivered", updatedAt: new Date().toISOString(),
      });
      // Удаляем purchase_lines этого заказа
      const plCol = collection(db, `tenants/${businessId}/purchase_lines`);
      const plSnap = await getDocs(query(plCol, where("orderId", "==", order.id)));
      await Promise.all(plSnap.docs.map(d => deleteDoc(d.ref)));
      if (debtItems.length > 0) {
        await setDoc(doc(db, `tenants/${businessId}/debts`, order.id), {
          orderId: order.id, customerName: order.customerName,
          assignedManager: order.assignedManager ?? null,
          deliveryDate: order.deliveryDate ?? null,
          ...(order.region ? { region: order.region } : {}),
          items: debtItems, createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      alert("Ошибка при отгрузке: " + String(e));
    }
    setUpdatingId(null);
  }

  async function updateField(orderId: string, field: string, value: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), { [field]: value });
  }

  async function assignSupplier(order: Order, idx: number, supplierId: string) {
    const items = order.items.map((it, i) => i === idx ? { ...it, supplierId } : it);
    await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { items });
  }

  async function replaceItem(order: Order, idx: number, picked: PickedItem) {
    const items = order.items.map((it, i) => i !== idx ? it : {
      ...it, productName: picked.productName, productId: picked.productId,
      barcode: picked.barcode, unitPrice: picked.unitPrice,
      quantity: picked.quantity, totalKopecks: picked.unitPrice * picked.quantity,
    });
    const totalKopecks = items.reduce((s, it) => s + it.totalKopecks, 0);
    await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { items, totalKopecks });
  }

  async function deleteItem(order: Order, idx: number) {
    const items = order.items.filter((_, i) => i !== idx);
    const totalKopecks = items.reduce((s, it) => s + it.totalKopecks, 0);
    await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { items, totalKopecks });
  }

  async function addItem(order: Order, picked: PickedItem) {
    const items = [...order.items, {
      productId: picked.productId || picked.barcode || "",
      productName: picked.productName, barcode: picked.barcode,
      quantity: picked.quantity, unitPrice: picked.unitPrice,
      totalKopecks: picked.unitPrice * picked.quantity, supplierId: null,
    }];
    const totalKopecks = items.reduce((s, it) => s + it.totalKopecks, 0);
    await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { items, totalKopecks });
  }

  async function createOrder() {
    if (!customerName.trim()) return;
    setSaving(true);
    try {
      const items = newOrderItems.map((p, i) => ({
        lineId: `new-${i}`, productId: p.productId, productName: p.productName,
        barcode: p.barcode ?? null, quantity: p.quantity, unitPrice: p.unitPrice,
        totalKopecks: p.unitPrice * p.quantity, supplierId: null,
      }));
      const totalKopecks = items.reduce((s, it) => s + it.totalKopecks, 0);
      await addDoc(collection(db, `tenants/${businessId}/orders`), {
        orderId: crypto.randomUUID(), customerName: customerName.trim(),
        phone, comment, source, status: "received" as OrderStatus,
        totalKopecks, managerId: uid, items, externalId: null, customerInn: null,
        ...(regionFilter ? { region: regionFilter } : {}),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      setCustomerName(""); setPhone(""); setComment(""); setSource("manual");
      setNewOrderItems([]);
      setShowForm(false);
    } catch (e) {
      console.error("createOrder:", e);
      alert("Ошибка сохранения: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  function setActual(orderId: string, idx: number, val: number) {
    setActualQtys((prev) => {
      const cur = prev[orderId] ?? [];
      const arr = Array.from({ length: Math.max(cur.length, idx + 1) }, (_, i) => cur[i] ?? 0);
      arr[idx] = val;
      return { ...prev, [orderId]: arr };
    });
    setDirtyOrders(prev => new Set(prev).add(orderId));
    clearTimeout(saveTimers.current[orderId]);
    saveTimers.current[orderId] = setTimeout(() => {
      const qtys = (actualQtysRef.current[orderId] ?? []).map(v => v ?? 0);
      // Пишем в assembly/{orderId} — sync НаПолке эту коллекцию не трогает
      void setDoc(doc(db, `tenants/${businessId}/assembly`, orderId), { qtys, updatedAt: new Date().toISOString() }, { merge: true })
        .then(() => setDirtyOrders(prev => { const s = new Set(prev); s.delete(orderId); return s; }));
    }, 1500);
  }

  function saveActualNow(orderId: string) {
    clearTimeout(saveTimers.current[orderId]);
    const qtys = (actualQtysRef.current[orderId] ?? []).map(v => v ?? 0);
    void setDoc(doc(db, `tenants/${businessId}/assembly`, orderId), { qtys, updatedAt: new Date().toISOString() }, { merge: true })
      .then(() => setDirtyOrders(prev => { const s = new Set(prev); s.delete(orderId); return s; }));
  }

  const COLS = 11; // total columns

  return (
    <div className="go-main">
      <div className="go-header"><h1 className="go-title">Заказы · Густорико</h1></div>

      {ordersError && (
        <div style={{ background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.3)",
          borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#B91C1C" }}>
          ⚠️ {ordersError}
        </div>
      )}

      <div className="go-stats">
        <div className="go-stat-card">
          <div className="label">Заказов в этом месяце</div>
          <div className="value">{monthOrders.length}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Оплачены</div>
          <div className="value">{cntPaid}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">В сборке</div>
          <div className="value">{cntAssembly}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Отгружены</div>
          <div className="value">{cntShipped}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Долги — недогружено</div>
          <div className="value" style={cntDebt > 0 ? { color: "#C62828" } : {}}>{cntDebt}</div>
        </div>
      </div>

      <div className="go-section-head">
        <h2>Заказы</h2>
        <button className="go-btn go-btn--gold" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Отмена" : "+ Новый заказ"}
        </button>
      </div>

      {showForm && (
        <div className="go-form">
          <h3>Новый заказ</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="go-field"><label>Клиент</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Имя / компания" />
            </div>
            <div className="go-field"><label>Телефон</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7..." />
            </div>
            <div className="go-field"><label>Источник</label>
              <select value={source} onChange={(e) => setSource(e.target.value as OrderSource)}>
                {(Object.keys(SOURCE_LABELS) as OrderSource[]).map((s) => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="go-field"><label>Комментарий</label>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Примечание" />
            </div>
          </div>
          {/* Позиции нового заказа */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#8B7355", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
              Позиции {newOrderItems.length > 0 && `(${newOrderItems.length})`}
            </div>
            {newOrderItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                {newOrderItems.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(200,154,52,.06)", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <span style={{ flex: 1 }}>{it.productName}</span>
                    <span style={{ color: "#8B7355", marginLeft: 8 }}>×{it.quantity}</span>
                    <span style={{ fontWeight: 600, marginLeft: 10 }}>{((it.unitPrice * it.quantity) / 100).toLocaleString("ru-RU")} ₽</span>
                    <button onClick={() => setNewOrderItems(p => p.filter((_, i) => i !== idx))}
                      style={{ marginLeft: 8, background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
                  </div>
                ))}
                <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: "#1A1814", padding: "4px 0" }}>
                  Итого: {(newOrderItems.reduce((s, it) => s + it.unitPrice * it.quantity, 0) / 100).toLocaleString("ru-RU")} ₽
                </div>
              </div>
            )}
            <button onClick={() => setShowNewItemPicker(true)}
              style={{ fontSize: 12, padding: "6px 14px", border: "1px dashed rgba(200,154,52,.5)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "#8B6914" }}>
              + Добавить позицию
            </button>
          </div>

          <button className="go-btn go-btn--gold" onClick={() => void createOrder()} disabled={saving || !customerName.trim()}>
            {saving ? "Сохраняем…" : "Создать заказ"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="go-search-input" style={{ flex: "1 1 180px", minWidth: 160 }}
          placeholder="Клиент или № заказа..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
          style={{ fontSize: 12, padding: "6px 8px", border: "1px solid rgba(200,154,52,.3)", borderRadius: 8, background: "#fff", color: filterDateFrom ? "#1A1814" : "#aaa" }}
          title="Дата от" />
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
          style={{ fontSize: 12, padding: "6px 8px", border: "1px solid rgba(200,154,52,.3)", borderRadius: 8, background: "#fff", color: filterDateTo ? "#1A1814" : "#aaa" }}
          title="Дата до" />
        <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
          style={{ fontSize: 12, padding: "6px 8px", border: "1px solid rgba(200,154,52,.3)", borderRadius: 8, background: "#fff", color: filterCity ? "#1A1814" : "#aaa", minWidth: 120 }}>
          <option value="">Все города</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={() => setSortMode(m => m === "status" ? "date" : "status")}
          style={{ fontSize: 11, padding: "6px 10px", border: "1px solid rgba(200,154,52,.4)", borderRadius: 8,
            background: sortMode === "status" ? "rgba(200,154,52,.1)" : "transparent",
            cursor: "pointer", color: "#8B6914", whiteSpace: "nowrap" }}>
          {sortMode === "status" ? "↕ По статусу" : "↕ По дате"}
        </button>
        {(search || filterDateFrom || filterDateTo || filterCity) && (
          <button onClick={() => { setSearch(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterCity(""); }}
            style={{ fontSize: 11, padding: "6px 10px", border: "1px solid #e0d8cc", borderRadius: 8, background: "transparent", cursor: "pointer", color: "#8B7355" }}>
            Сбросить
          </button>
        )}
      </div>

      {loading ? <div className="go-empty">Загрузка…</div>
      : filtered.length === 0 ? <div className="go-empty">{search ? `Не найдено: «${search}»` : "Заказов нет"}</div>
      : (
        <div className="go-table-wrap">
          <table className="go-table" style={{ tableLayout: "fixed", width: colWidths.reduce((a, b) => a + b, 0) }}>
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                {COL_NAMES.map((name, i) => {
                  const colKey = i === 1 ? "date" : i === 2 ? "delivery" : i === 8 ? "sum" : null;
                  const active = sortCol === colKey;
                  return (
                    <th key={i} style={{ ...(i === 6 ? { textAlign: "center" } : {}), ...(colKey ? { cursor: "pointer", userSelect: "none" } : {}) }}
                      onClick={colKey ? () => {
                        if (sortCol === colKey) setSortDir(d => d === "asc" ? "desc" : "asc");
                        else { setSortCol(colKey); setSortDir("asc"); }
                      } : undefined}
                    >
                      {name}{colKey ? (active ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅") : ""}
                      <div className="go-col-resize" onMouseDown={(e) => startResize(i, e)} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const actuals = actualQtys[o.id] ?? [];
                const progress = calcProgress(o.items, actuals);
                const actions = NEXT_ACTIONS[o.status] ?? [];
                // sourcing/delivered перекрывают «оплачено»; иначе — оплаченные зелёные
                const rowKey = (o.status === "sourcing" || o.status === "delivered")
                  ? o.status
                  : (o.paid ? "paid" : o.status);
                const rowBg = expandedId === o.id ? "rgba(21,101,192,.08)" : (STATUS_ROW_BG[rowKey] ?? undefined);
                const isCancelled = o.status === "cancelled";
                return (
                  <>
                    <tr key={o.id}
                      style={{ cursor: "pointer", background: rowBg, opacity: isCancelled ? 0.6 : 1 }}
                      onClick={() => {
                        if (expandedId === o.id) {
                          if (dirtyOrders.has(o.id)) saveActualNow(o.id);
                          setExpandedId(null);
                        } else {
                          setExpandedId(o.id);
                        }
                      }}
                    >
                      <td style={{ fontSize: 11, color: "#8B7355", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                        {o.externalId || o.orderId?.slice(0, 8) || "—"}
                      </td>
                      <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>

                      {/* Дата отгрузки — редактируемая */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="date"
                          value={o.deliveryDate ? o.deliveryDate.slice(0, 10) : ""}
                          onChange={(e) => void updateField(o.id, "deliveryDate", e.target.value)}
                          style={{ fontSize: 11, border: "none", background: "transparent", color: o.deliveryDate ? "#1A1814" : "#aaa", cursor: "pointer", width: "100%", padding: 0 }}
                        />
                      </td>

                      <td style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customerName}</td>

                      {/* Менеджер */}
                      <td onClick={(e) => e.stopPropagation()}>
                        {readonlyManager
                          ? <span style={{ fontSize: 11, color: "#555" }}>{o.assignedManager || "—"}</span>
                          : <select value={o.assignedManager ?? ""}
                              onChange={(e) => void updateField(o.id, "assignedManager", e.target.value)}
                              style={{ fontSize: 11, border: "1px solid #e0d8cc", borderRadius: 4, padding: "2px 4px", background: "transparent", width: "100%", color: o.assignedManager ? "#1A1814" : "#aaa" }}
                            >
                              <option value="">— выбрать</option>
                              {MANAGERS.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        }
                      </td>

                      <td style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>
                        {o.phone
                          ? <PhoneButton phone={o.phone} extension={findExtension(o.assignedManager)} size={11} />
                          : "—"}
                      </td>

                      <td style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={o.address || ""}>{extractCity(o.address, o.region)}</td>

                      <td style={{ textAlign: "center", fontSize: 12 }}>{o.items.length || "—"}</td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtRub(o.totalKopecks)}</td>

                      <td>
                        <span className="go-badge" style={{
                          background: o.paid ? "rgba(46,175,80,.25)" : statusColor(o.status) + "22",
                          color:      o.paid ? "#1B5E20"             : statusColor(o.status),
                          fontSize: 10, fontWeight: o.paid ? 700 : undefined,
                        }}>
                          {o.paid ? "Оплачено" : statusLabel(o.status)}
                        </span>
                        {actuals.some((v) => v > 0) && (
                          <div style={{ fontSize: 10, color: progress === 100 ? "#1565C0" : "#D97706", marginTop: 2 }}>{progress}%</div>
                        )}
                        {onGoToAssembly && (o.status === "approved" || o.status === "sourcing") && (
                          <div
                            role="button"
                            onClick={(e) => { e.stopPropagation(); onGoToAssembly(o.id); }}
                            style={{ fontSize: 9, color: "#6A1B9A", marginTop: 2, cursor: "pointer", textDecoration: "underline dotted" }}
                          >
                            📦 → Сборка
                          </div>
                        )}
                        {o.status !== "delivered" && o.status !== "cancelled" && (() => {
                          const fromISO = o.paid ? (o.paidAt ?? o.createdAt) : o.createdAt;
                          const t = deadlineTimer(fromISO, 3);
                          const typeIcon = o.paid ? "🚚" : "💳";
                          const typeHint = o.paid ? "до отгрузки" : "до оплаты";
                          return (
                            <div title={typeHint} style={{ fontSize: 9, color: t.color, marginTop: 2, lineHeight: 1.4 }}>
                              {t.dot} {t.label} {typeIcon}
                            </div>
                          );
                        })()}
                      </td>

                      <td onClick={(e) => e.stopPropagation()}>
                        {updatingId === o.id ? <span style={{ fontSize: 11, color: "#8B7355" }}>…</span> : (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {/* Отгрузить — всегда для оплаченных незавершённых */}
                            {o.status !== "delivered" && o.status !== "cancelled" && (
                              <button onClick={() => void deliverFromSales(o)}
                                style={{ padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                                  border: "1px solid #2E7D3244", borderRadius: 6, background: "rgba(46,125,50,.08)", color: "#2E7D32", whiteSpace: "nowrap" }}>
                                Отгрузить
                              </button>
                            )}
                            {actions.map((a) => (
                              <button key={a.status} onClick={() => void changeStatus(o, a.status)}
                                style={{ padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                                  border: `1px solid ${a.color}44`, borderRadius: 6, background: "transparent", color: a.color, whiteSpace: "nowrap" }}>
                                {a.label}
                              </button>
                            ))}
                            {!o.paid && o.status !== "delivered" && o.status !== "cancelled" && (
                              <button onClick={() => setInvoiceOrder(o)}
                                style={{ padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                                  border: "1px solid #AD145744", borderRadius: 6, background: "transparent", color: "#AD1457", whiteSpace: "nowrap" }}>
                                Счёт
                              </button>
                            )}
                            {o.status !== "cancelled" && (
                              <button onClick={() => setUpdOrder(o)}
                                style={{ padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                                  border: "1px solid rgba(200,154,52,.4)", borderRadius: 6, background: "transparent", color: "#8B6914", whiteSpace: "nowrap" }}>
                                УПД
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {expandedId === o.id && (
                      <tr key={o.id + "-detail"}>
                        <td colSpan={COLS} style={{ padding: "8px 16px", background: "rgba(21,101,192,.03)", fontSize: 12 }}>
                          {/* Полный адрес */}
                          {o.address && (
                            <p style={{ margin: "0 0 8px", color: "#555" }}>
                              <strong>Адрес:</strong> {o.address}
                            </p>
                          )}
                          {o.items.length === 0 ? <span style={{ color: "#aaa" }}>Позиции не заданы</span> : (
                            <>
                              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                                <colgroup>
                                  <col style={{ width: "auto" }} />
                                  <col style={{ width: 100 }} />
                                  <col style={{ width: 55 }} />
                                  <col style={{ width: 65 }} />
                                  <col style={{ width: 28 }} />
                                  <col style={{ width: 68 }} />
                                  <col style={{ width: 78 }} />
                                  <col style={{ width: 155 }} />
                                  <col style={{ width: 70 }} />
                                </colgroup>
                                <thead>
                                  <tr style={{ borderBottom: "1px solid #e0d8cc" }}>
                                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Наименование</th>
                                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Арт./ШК</th>
                                    <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Кол</th>
                                    <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Факт</th>
                                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>✓</th>
                                    <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Цена</th>
                                    <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Итого</th>
                                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355", fontSize: 11 }}>Поставщик</th>
                                    <th style={{ padding: "3px 6px" }} />
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.items.map((item, i) => {
                                    const actual = actuals[i] ?? 0;
                                    const done = actual >= item.quantity;
                                    const partial = actual > 0 && !done;
                                    return (
                                      <tr key={i} style={{ borderBottom: "1px solid #f0ece5" }}>
                                        <td style={{ padding: "3px 6px", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                          title={item.productName}>{item.productName}</td>
                                        <td style={{ padding: "3px 6px", color: "#8B7355", fontSize: 10, fontFamily: "monospace",
                                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {item.barcode || item.productId || "—"}
                                        </td>
                                        <td style={{ padding: "3px 6px", textAlign: "right", fontSize: 12 }}>{item.quantity}</td>
                                        <td style={{ padding: "3px 6px", textAlign: "right" }}>
                                          <input type="number" min={0} value={actual || ""}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => setActual(o.id, i, Number(e.target.value))}
                                            style={{ width: 52, textAlign: "right", fontSize: 11, padding: "2px 4px", border: "1px solid #e0d8cc", borderRadius: 4 }} />
                                        </td>
                                        <td style={{ padding: "3px 6px", textAlign: "center", fontSize: 13 }}>
                                          {done ? "✅" : partial ? "🟡" : "⬜"}
                                        </td>
                                        <td style={{ padding: "3px 6px", textAlign: "right", fontSize: 12 }}>{fmtRub(item.unitPrice)}</td>
                                        <td style={{ padding: "3px 6px", textAlign: "right", fontSize: 12 }}>{fmtRub(item.totalKopecks)}</td>
                                        <td style={{ padding: "3px 6px" }}>
                                          {assemblySuppliers[o.id]?.[i] ? (
                                            <span style={{ fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>
                                              {assemblySuppliers[o.id][i]}
                                            </span>
                                          ) : (
                                            <select
                                              value={item.supplierId ?? ""}
                                              onClick={(e) => e.stopPropagation()}
                                              onChange={(e) => { if (e.target.value) void assignSupplier(o, i, e.target.value); }}
                                              style={{
                                                fontSize: 11, padding: "2px 4px", borderRadius: 4, width: "100%",
                                                border: item.supplierId ? "1px solid rgba(46,125,50,.3)" : "1px solid #e0d8cc",
                                                color: item.supplierId === "СКЛАД" ? "#2E7D32" : item.supplierId ? "#1A1814" : "#8B7355",
                                                fontWeight: item.supplierId === "СКЛАД" ? 700 : 400,
                                                background: item.supplierId ? "rgba(46,125,50,.05)" : "transparent",
                                              }}>
                                              <option value="">— выбрать</option>
                                              {SUPPLIER_OPTIONS.map((s) => (
                                                <option key={s.id} value={s.id}>{s.label}</option>
                                              ))}
                                            </select>
                                          )}
                                        </td>
                                        <td style={{ padding: "3px 4px", textAlign: "center", whiteSpace: "nowrap" }}>
                                          <button onClick={(e) => { e.stopPropagation(); setEditItem({ order: o, idx: i }); }}
                                            title="Заменить позицию"
                                            style={{ fontSize: 13, padding: "2px 6px", border: "1px solid #e0d8cc", borderRadius: 4,
                                              background: "transparent", cursor: "pointer", color: "#8B7355" }}>↻</button>
                                          <button onClick={(e) => { e.stopPropagation(); void deleteItem(o, i); }}
                                            title="Удалить строку"
                                            style={{ fontSize: 13, padding: "2px 6px", border: "1px solid rgba(220,38,38,.25)", borderRadius: 4,
                                              background: "transparent", cursor: "pointer", color: "#DC2626", marginLeft: 2 }}>×</button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr style={{ borderTop: "2px solid #e0d8cc", fontWeight: 600 }}>
                                    <td colSpan={5} style={{ padding: "5px 6px", textAlign: "right", color: "#8B7355", fontSize: 11 }}>Итого заказ:</td>
                                    <td colSpan={2} style={{ padding: "5px 6px", textAlign: "right" }}>{fmtRub(o.totalKopecks)}</td>
                                    <td colSpan={2} style={{ padding: "5px 6px", fontSize: 11, color: progress === 100 ? "#1565C0" : "#D97706" }}>
                                      {actuals.some((v) => v > 0) ? (() => {
                                        const assembledKopecks = o.items.reduce((s, it, i) => s + Math.min(actuals[i] ?? 0, it.quantity) * it.unitPrice, 0);
                                        return `${progress}% · ${fmtRub(assembledKopecks)}`;
                                      })() : ""}
                                    </td>
                                  </tr>
                                  <tr>
                                    <td colSpan={9} style={{ padding: "6px 6px 2px", display: "flex", gap: 8, alignItems: "center" }}>
                                      <button onClick={(e) => { e.stopPropagation(); setEditItem({ order: o, idx: null }); }}
                                        style={{ fontSize: 12, padding: "4px 12px", border: "1px dashed #C89A34", borderRadius: 6,
                                          background: "rgba(200,154,52,.05)", cursor: "pointer", color: "#8B6914", fontWeight: 600 }}>
                                        + Добавить позицию
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); saveActualNow(o.id); }}
                                        disabled={!dirtyOrders.has(o.id)}
                                        style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, fontWeight: 600, cursor: dirtyOrders.has(o.id) ? "pointer" : "default",
                                          border: dirtyOrders.has(o.id) ? "1px solid #1565C0" : "1px solid #e0d8cc",
                                          background: dirtyOrders.has(o.id) ? "#1565C0" : "#f5f5f5",
                                          color: dirtyOrders.has(o.id) ? "#fff" : "#aaa" }}>
                                        💾 Сохранить факт
                                      </button>
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                              <div style={{ marginTop: 8 }}>
                                <textarea
                                  placeholder="Комментарий к заказу…"
                                  value={commentEdits[o.id] ?? o.comment ?? ""}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setCommentEdits(prev => ({ ...prev, [o.id]: e.target.value }))}
                                  onBlur={() => {
                                    const val = commentEdits[o.id] ?? "";
                                    if (val !== (o.comment ?? "")) void updateField(o.id, "comment", val);
                                  }}
                                  rows={2}
                                  style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid #e0d8cc",
                                    borderRadius: 6, resize: "vertical", color: "#555", fontFamily: "inherit", boxSizing: "border-box" }}
                                />
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {invoiceOrder && (
        <InvoiceModal order={invoiceOrder} businessId={businessId} onClose={() => setInvoiceOrder(null)} />
      )}

      {updOrder && (
        <UpdModal
          orderNum={updOrder.id.slice(-6)}
          customerName={updOrder.customerName}
          customerInn={(updOrder as typeof updOrder & { customerInn?: string }).customerInn}
          customerAddr={updOrder.address}
          items={(updOrder.items ?? []).map(it => ({
            name: it.productName,
            qty: it.quantity ?? 1,
            unit: "шт",
            price: (it.unitPrice ?? 0) / 100,
            selected: true,
          } as UpdItem))}
          onClose={() => setUpdOrder(null)}
        />
      )}

      {showNewItemPicker && (
        <ItemPickerModal
          title="Добавить позицию в новый заказ"
          defaultQty={1}
          onSelect={(item) => { setNewOrderItems(p => [...p, item]); setShowNewItemPicker(false); return Promise.resolve(); }}
          onClose={() => setShowNewItemPicker(false)}
        />
      )}
      {editItem && (
        <ItemPickerModal
          title={editItem.idx === null ? "Добавить позицию в заказ" : "Заменить позицию"}
          defaultQty={editItem.idx !== null ? (editItem.order.items[editItem.idx]?.quantity ?? 1) : 1}
          onSelect={async (item) => {
            if (editItem.idx === null) await addItem(editItem.order, item);
            else await replaceItem(editItem.order, editItem.idx, item);
            setEditItem(null);
          }}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  );
}
