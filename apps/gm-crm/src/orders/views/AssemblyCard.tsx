import { useState, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { doc, setDoc, onSnapshot, addDoc, collection, updateDoc, getDocs, query, where, deleteDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { type Order, type PricelistMatch, fmtRub, deadlineTimer } from "../useOrders";
import { computePlMatches, type PlIndex } from "../plIndex";
import { UpdModal } from "./UpdModal";
import type { UpdItem } from "./UpdModal";
import { parseQty, rubToKopecks, useNumDrafts } from "../numInput";
import { normalizeRegion } from "../region";
import { type ALine, type SavedLine, type StockIndex, STOCK, avgCost, buildLine, itemQty, mergeLine, addWorkDaysMsk } from "../stockOps";
import { shipOrder, ensureDeliveryDate } from "../shipment";
import { itemTotalKopecks } from "../money";
import { useMinuteTick } from "../useMinuteTick";

interface Props { order: Order; businessId: string; uid: string; allSupplierNames: string[]; plIndex: PlIndex; showManagerAssign?: boolean; isFocused?: boolean; stockMap: StockIndex | null }

const MANAGERS = ["Марина", "Ольга", "Анна"];

const th: CSSProperties = { padding: "5px 8px", textAlign: "left", color: "#8B7355", fontWeight: 500, whiteSpace: "nowrap", fontSize: 11 };
const td: CSSProperties = { padding: "3px 8px", verticalAlign: "middle" };

function fmtRubFull(kopecks: number): string {
  return (kopecks / 100).toLocaleString("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dedup(matches: PricelistMatch[]): PricelistMatch[] {
  const map = new Map<string, PricelistMatch>();
  for (const m of matches) {
    const e = map.get(m.supplierName);
    if (!e || (m.priceKopecks ?? Infinity) < (e.priceKopecks ?? Infinity)) map.set(m.supplierName, m);
  }
  return Array.from(map.values()).sort((a, b) => (a.priceKopecks ?? 0) - (b.priceKopecks ?? 0));
}

export function AssemblyCard({ order, businessId, uid, allSupplierNames, plIndex, showManagerAssign = false, isFocused = false, stockMap }: Props) {
  const [lines, setLines] = useState<ALine[] | null>(null);
  // undefined — документ сборки ещё не прочитан; null — сохранённых строк нет
  const [saved, setSaved] = useState<SavedLine[] | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [editing, setEditing] = useState<{ idx: number; name: string; barcode: string } | null>(null);
  const [showUpd, setShowUpd] = useState(false);
  useMinuteTick(); // дедлайн перерисовывается раз в минуту
  const cardRef      = useRef<HTMLDivElement>(null);
  const linesRef     = useRef<ALine[]>([]);
  const lastEditRef  = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const dirtyRef     = useRef(false);
  const drafts       = useNumDrafts();
  const region       = normalizeRegion(order.region, order.address);

  // Скролл к карточке при фокусе из заказов
  useEffect(() => {
    if (isFocused) {
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [isFocused]);

  // deliveryDate = paidAt + 3 рабочих дня — только если дата пустая (ручную дату менеджера не трогаем)
  useEffect(() => {
    if (!order.paid || !order.paidAt || order.deliveryDate) return;
    ensureDeliveryDate(businessId, order.id, addWorkDaysMsk(order.paidAt, 3)).catch(console.error);
  }, [businessId, order.id, order.paid, order.paidAt, order.deliveryDate]);

  // Вынесено из useEffect чтобы переиспользовать при замене позиции
  // Подбор по нормализованному штрихкоду/артикулу → по словам названия (см. ../plIndex)
  function computeMatches(item: { productName: string; barcode?: string | null; productId?: string }): PricelistMatch[] {
    return computePlMatches(plIndex, item);
  }

  useEffect(() => {
    const ref = doc(db, `tenants/${businessId}/assembly/${order.id}`);
    const unsub = onSnapshot(ref, (snap) => {
      if (Date.now() - lastEditRef.current < 3000) return;
      setSaved(snap.exists() ? ((snap.data().lines as SavedLine[] | undefined) ?? null) : null);
    });
    return () => {
      unsub();
      clearTimeout(saveTimerRef.current);
      if (dirtyRef.current && linesRef.current.length) void persist(linesRef.current);
    };
  }, [order.id]); // eslint-disable-line

  // Перестраиваем при смене состава заказа и после загрузки остатков/прайса.
  // Приоритет: несохранённые правки → сохранённые строки → построенные заново.
  const itemsKey = order.items.map(it => `${it.barcode ?? ""}|${it.productName}|${itemQty(it)}|${it.supplierId ?? ""}`).join(";");
  useEffect(() => {
    if (saved === undefined || !stockMap) return;
    const base: SavedLine[] = dirtyRef.current ? linesRef.current : (saved ?? []);
    const built = order.items.map((item, idx) => {
      const l = mergeLine(base.find(x => x.idx === idx), item, buildLine(item, idx, computeMatches(item), stockMap, region));
      // старые строки «Склад» сохранены с себестоимостью 0 — подставляем среднюю цену прихода
      return l.supplierName === STOCK && !l.unitCostKopecks ? { ...l, unitCostKopecks: avgCost(stockMap, region, l) } : l;
    });
    setLines(built);
    linesRef.current = built;
  }, [saved, itemsKey, stockMap, plIndex, region]); // eslint-disable-line

  function patch(idx: number, p: Partial<ALine>) {
    setLines(prev => {
      const updated = (prev ?? []).map(l => l.idx === idx ? { ...l, ...p } : l);
      linesRef.current = updated;
      return updated;
    });
    lastEditRef.current = Date.now();
    dirtyRef.current = true;
    setIsDirty(true);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persist(linesRef.current), 1500);
  }

  function confirmReplace() {
    if (!editing) return;
    const newMatches = computeMatches({ productName: editing.name, barcode: editing.barcode || null });
    const best = newMatches[0];
    drafts.clear(`cost-${editing.idx}`);
    patch(editing.idx, {
      productName: editing.name,
      barcode: editing.barcode || null,
      replaced: true,
      matches: newMatches,
      supplierName: best?.supplierName ?? "",
      supplierId:   best?.supplierId ?? "",
      unitCostKopecks: best?.priceKopecks ?? 0,
    });
    setEditing(null);
  }

  async function persist(ls: ALine[]) {
    if (!ls.length) return;
    setSaving(true);
    try {
      const toSave = ls.map(({ matches: _m, ...l }) => l);
      await setDoc(
        doc(db, `tenants/${businessId}/assembly/${order.id}`),
        { lines: toSave, assembler: uid, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      setSaved(toSave); // свой снимок в окне 3 с игнорируется — иначе saved останется старым
      dirtyRef.current = false;
      setIsDirty(false);
    } catch (e) {
      console.error("Assembly save failed:", e);
      alert("Ошибка сохранения: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deletePendingLines() {
    const snap = await getDocs(
      query(collection(db, `tenants/${businessId}/purchase_lines`),
        where("orderId", "==", order.id), where("status", "==", "pending"))
    );
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  }

  async function resetPurchase() {
    try {
      await deletePendingLines();
    } catch (e) {
      console.error("Reset purchase failed:", e);
      alert("Ошибка сохранения: " + String(e));
      return;
    }
    const updated = linesRef.current.map(l => ({ ...l, sentToPurchase: false }));
    linesRef.current = updated;
    setLines(updated);
    void persist(updated);
  }

  async function distribute() {
    const ls = linesRef.current;
    // Берём ВСЕ позиции с поставщиком (не только новые) — предварительно чистим старые pending
    const toOrder = ls.filter(l => l.supplierName && l.supplierName !== "Склад");
    const toStock  = ls.filter(l => l.supplierName === "Склад");
    if (!toOrder.length && !toStock.length) return;

    try {
      if (order.status === "approved") {
        await updateDoc(doc(db, `tenants/${businessId}/orders/${order.id}`), {
          status: "sourcing", updatedAt: new Date().toISOString(),
        });
      }

      // Удаляем старые pending lines — чтобы не висела история при смене поставщика
      await deletePendingLines();

      if (toOrder.length) {
        await Promise.all(toOrder.map(l =>
          addDoc(collection(db, `tenants/${businessId}/purchase_lines`), {
            orderId: order.id, customerName: order.customerName,
            productName: l.productName, barcode: l.barcode,
            supplierName: l.supplierName, supplierId: l.supplierId,
            qty: l.qtyPacked || l.qtyOrdered,
            unitCostKopecks: l.unitCostKopecks,
            assembler: uid, status: "pending", createdAt: new Date().toISOString(),
          }),
        ));
      }
    } catch (e) {
      console.error("Distribute failed:", e);
      alert("Ошибка сохранения: " + String(e));
      return;
    }
    const toMark = new Set([...toOrder, ...toStock].map(l => l.idx));
    const updated = ls.map(l => toMark.has(l.idx) ? { ...l, sentToPurchase: true } : l);
    linesRef.current = updated;
    setLines(updated);
    void persist(updated);
  }

  async function deliver() {
    if (shipping) return;
    setShipping(true);
    clearTimeout(saveTimerRef.current);
    try {
      await shipOrder(businessId, order, linesRef.current.map(({ matches: _m, ...l }) => l), uid);
      dirtyRef.current = false;
    } catch (e) {
      console.error("Deliver failed:", e);
      alert("Ошибка при отгрузке: " + String(e));
    } finally {
      setShipping(false);
    }
  }

  async function returnToReceived() {
    try {
      await updateDoc(doc(db, `tenants/${businessId}/orders/${order.id}`), {
        status: "received", updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Return to received failed:", e);
      alert("Ошибка: " + String(e));
    }
  }

  if (!lines) return (
    <div className="go-card" style={{ opacity: 0.6 }}>
      <div className="go-card-title">{order.customerName}</div>
      <div style={{ fontSize: 12, color: "#aaa" }}>Загрузка прайса…</div>
    </div>
  );

  const sell        = lines.reduce((s, l) => s + l.unitSellKopecks * l.qtyPacked, 0);
  const cost        = lines.reduce((s, l) => s + l.unitCostKopecks * l.qtyPacked, 0);
  const profit      = sell - cost;
  const sellAll     = lines.reduce((s, l) => s + l.unitSellKopecks * l.qtyOrdered, 0);
  const costAll     = lines.reduce((s, l) => s + l.unitCostKopecks * l.qtyOrdered, 0);
  const profitAll   = sellAll - costAll;
  const packed      = lines.reduce((s, l) => s + l.qtyPacked, 0);
  const ordered     = lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const progress = ordered > 0 ? packed / ordered : 0;

  const bySource: Record<string, { name: string; cost: number; isStock: boolean }> = {};
  for (const l of lines) {
    if (!l.supplierName) continue;
    const e = bySource[l.supplierName] ?? { name: l.supplierName, cost: 0, isStock: l.supplierName === "Склад" };
    e.cost += l.unitCostKopecks * l.qtyPacked; bySource[l.supplierName] = e;
  }
  const hasPending = lines.some(l => !l.sentToPurchase && l.supplierName);
  const allSent    = lines.length > 0 && lines.every(l => l.sentToPurchase);

  // Дедлайн: если оплачено — от paidAt (до отгрузки), иначе от createdAt (до оплаты)
  const deadlineFrom  = order.paid ? (order.paidAt ?? order.createdAt) : order.createdAt;
  const deadline      = deadlineTimer(deadlineFrom, 3);
  const deadlineLabel = order.paid ? `${deadline.dot} ${deadline.label} до отгрузки 🚚` : `${deadline.dot} ${deadline.label} до оплаты 💳`;
  const borderColor = isFocused ? "#6A1B9A" : deadline.overdue ? "#C62828" : deadline.color === "#E65100" ? "#E65100" : "#e0d8cc";
  const headerBg    = isFocused ? "rgba(106,27,154,.07)" : deadline.overdue ? "rgba(198,40,40,.06)" : deadline.color === "#E65100" ? "rgba(230,81,0,.05)" : "rgba(200,154,52,.07)";

  return (
    <>
    <div ref={cardRef} style={{ background:"#fff", border:`1.5px solid ${borderColor}`, borderRadius:12, marginBottom:20, overflow:"hidden" }}>
      <div style={{ padding:"12px 16px", background:headerBg, borderBottom:`1px solid ${borderColor}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15 }}>{order.customerName}</div>
          <div style={{ fontSize:11, color:"#8B7355", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span>{new Date(order.createdAt).toLocaleDateString("ru-RU")} · {order.items.length} поз.{order.address && ` · ${order.address}`}</span>
            {order.phone && <span>📞 {order.phone}</span>}
            <span style={{ color: deadline.color, fontWeight: 600 }}>{deadlineLabel}</span>
            {showManagerAssign ? (
              <select
                value={order.assignedManager ?? ""}
                onChange={e => void updateDoc(doc(db, `tenants/${businessId}/orders/${order.id}`), { assignedManager: e.target.value, updatedAt: new Date().toISOString() })}
                style={{ fontSize:11, border:"1px solid #e0d8cc", borderRadius:5, padding:"1px 5px",
                  background: order.assignedManager ? "rgba(200,154,52,.12)" : "#fff",
                  color: order.assignedManager ? "#5A4A35" : "#aaa", cursor:"pointer" }}>
                <option value="">— менеджер</option>
                {MANAGERS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : order.assignedManager ? (
              <span style={{ background:"rgba(200,154,52,.12)", color:"#5A4A35", borderRadius:5, padding:"1px 8px" }}>
                {order.assignedManager}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ textAlign:"right", display:"flex", alignItems:"center", gap:8 }}>
          {saving && <span style={{ fontSize:10, color:"#aaa" }}>сохр…</span>}
          <div>
            <div style={{ fontSize:11, color: progress===0?"#aaa":progress<1?"#C62828":"#2E7D32" }}>{Math.round(progress*100)}% упаковано</div>
            <div style={{ width:80, height:6, background:"#e0d8cc", borderRadius:3, marginTop:3 }}>
              <div style={{ width:`${Math.min(progress*100,100)}%`, height:"100%", background:progress>=0.8?"#2E7D32":"#E65100", borderRadius:3, transition:"width .3s" }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead><tr style={{ background:"#faf7f2" }}>
            <th style={{ ...th, width:"22%", minWidth:120 }}>Наименование</th>
            <th style={{ ...th, textAlign:"right" }}>Заказ.</th>
            <th style={{ ...th, textAlign:"right" }}>Упак.</th>
            <th style={{ ...th, textAlign:"right" }}>Прод.</th>
            <th style={{ ...th }} colSpan={2}>Поставщик · закуп. ₽/шт</th>
            <th style={{ ...th, textAlign:"right" }}>Δ прибыль</th>
          </tr></thead>
          <tbody>
            {lines.map(l => {
              // ── Режим редактирования (замена позиции) ──────────────────────────
              if (editing?.idx === l.idx) {
                return (
                  <tr key={l.idx} style={{ background:"#fffde7" }}>
                    <td colSpan={7} style={{ padding:"8px 10px" }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, color:"#8B6914", whiteSpace:"nowrap" }}>Замена для: <i>{l.productName}</i></span>
                        <input
                          autoFocus
                          placeholder="Новое наименование"
                          value={editing.name}
                          onChange={e => setEditing(prev => prev && ({ ...prev, name: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") confirmReplace(); if (e.key === "Escape") setEditing(null); }}
                          style={{ flex:1, minWidth:160, fontSize:12, border:"1px solid #c8a434", borderRadius:5, padding:"4px 8px" }}
                        />
                        <input
                          placeholder="Штрихкод (необяз.)"
                          value={editing.barcode}
                          onChange={e => setEditing(prev => prev && ({ ...prev, barcode: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") confirmReplace(); if (e.key === "Escape") setEditing(null); }}
                          style={{ width:130, fontSize:12, border:"1px solid #e0d8cc", borderRadius:5, padding:"4px 8px", fontFamily:"monospace" }}
                        />
                        <button onClick={confirmReplace}
                          disabled={!editing.name.trim()}
                          style={{ fontSize:12, padding:"4px 14px", borderRadius:5, cursor:"pointer",
                            background:"#c8a434", color:"#fff", border:"none", fontWeight:600 }}>
                          ✓ Заменить
                        </button>
                        <button onClick={() => setEditing(null)}
                          style={{ fontSize:12, padding:"4px 10px", borderRadius:5, cursor:"pointer",
                            background:"none", border:"1px solid #ccc", color:"#888" }}>
                          Отмена
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              // ── Обычная строка ─────────────────────────────────────────────────
              const d = (l.unitSellKopecks - l.unitCostKopecks) * l.qtyPacked;
              const debt = Math.round((l.qtyOrdered - l.qtyPacked) * 1000) / 1000;
              const unique = dedup(l.matches);
              const isStock = l.supplierName === "Склад";
              return (
                <tr key={l.idx} style={{ borderBottom:"1px solid #f0ece5", background:l.sentToPurchase?"rgba(46,125,50,.03)":l.replaced?"rgba(200,154,52,.05)":undefined }}>
                  <td style={{ ...td, maxWidth:180, whiteSpace:"normal", wordBreak:"break-word" }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:4 }}>
                      <div style={{ flex:1 }}>
                        {l.productName}
                        {l.barcode && <div style={{ fontSize:10, color:"#aaa", marginTop:1, fontFamily:"monospace" }}>{l.barcode}</div>}
                        {l.replaced && <span style={{ fontSize:10, color:"#8B6914", marginTop:1, display:"block" }}>↺ заменено</span>}
                        {!l.replaced && debt > 0 && l.qtyPacked > 0 && <span style={{ color:"#C62828", fontSize:10, marginLeft:4 }}>−{debt} долг</span>}
                        {!l.replaced && l.qtyPacked === 0 && l.qtyOrdered > 0 && <span style={{ color:"#C62828", fontSize:10, display:"block" }}>долг {l.qtyOrdered} шт</span>}
                        {l.sentToPurchase && <span style={{ color:"#2E7D32", fontSize:10, marginLeft:4 }}>✓</span>}
                      </div>
                      {/* Кнопка замены позиции */}
                      <button
                        title="Заменить позицию"
                        onClick={() => setEditing({ idx: l.idx, name: "", barcode: "" })}
                        style={{ fontSize:11, padding:"1px 5px", borderRadius:4, cursor:"pointer",
                          border:"1px solid #ddd", background:"none", color:"#aaa", flexShrink:0, marginTop:1 }}>
                        ✎
                      </button>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign:"right", color:"#8B7355" }}>{l.qtyOrdered}</td>
                  <td style={{ ...td, textAlign:"right" }}>
                    <input type="text" inputMode="decimal" value={drafts.value(`qty-${l.idx}`, String(l.qtyPacked))}
                      onChange={e => {
                        const t = e.target.value;
                        const q = t.trim() === "" ? 0 : parseQty(t, true);
                        drafts.set(`qty-${l.idx}`, t, q !== null);
                        if (q !== null) patch(l.idx, { qtyPacked: q });
                      }}
                      onBlur={() => { if (!drafts.invalid(`qty-${l.idx}`)) drafts.clear(`qty-${l.idx}`); }}
                      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      title={l.qtyPacked > l.qtyOrdered ? `+${Math.round((l.qtyPacked - l.qtyOrdered) * 1000) / 1000} сверх заявки` : undefined}
                      style={{ width:50, textAlign:"right", border: drafts.invalid(`qty-${l.idx}`) ? "1px solid #C62828" : "1px solid #e0d8cc", borderRadius:4, padding:"2px 4px",
                        background: l.qtyPacked > l.qtyOrdered ? "#FFFDE7" : undefined }} />
                  </td>
                  <td style={{ ...td, textAlign:"right" }}>{fmtRubFull(l.unitSellKopecks)}</td>
                  <td style={{ ...td, width:"auto" }} colSpan={2}>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4, alignItems:"center" }}>
                      {unique.map(m => {
                        const sel = l.supplierName === m.supplierName;
                        return (
                          <button key={m.supplierId}
                            onClick={() => { drafts.clear(`cost-${l.idx}`); patch(l.idx, { supplierName:m.supplierName, supplierId:m.supplierId, unitCostKopecks:m.priceKopecks??0 }); }}
                            style={{ fontSize:11, padding:"3px 9px", borderRadius:5, cursor:"pointer", whiteSpace:"nowrap",
                              border: sel ? "1.5px solid #c8a434" : "1px solid #ddd",
                              background: sel ? "rgba(200,154,52,.18)" : "#fafaf9",
                              color: sel ? "#5A4A35" : "#666", fontWeight: sel ? 700 : 400 }}>
                            {m.supplierName}
                            {m.priceKopecks ? <span style={{ marginLeft:5, color: sel?"#8B6914":"#999" }}>{(m.priceKopecks/100).toFixed(2)}₽</span> : null}
                          </button>
                        );
                      })}
                      <button onClick={() => { drafts.clear(`cost-${l.idx}`); patch(l.idx, { supplierName:"Склад", supplierId:"stock", unitCostKopecks: stockMap ? avgCost(stockMap, region, l) : 0 }); }}
                        style={{ fontSize:11, padding:"3px 9px", borderRadius:5, cursor:"pointer",
                          border: isStock?"1.5px solid #2E7D32":"1px solid #ddd",
                          background: isStock?"rgba(46,125,50,.1)":"transparent", color:isStock?"#2E7D32":"#888" }}>
                        🏪 Склад
                      </button>
                      <select
                        value={unique.some(m=>m.supplierName===l.supplierName)||isStock ? "" : l.supplierName}
                        onChange={e => { const n=e.target.value; if(n) { drafts.clear(`cost-${l.idx}`); patch(l.idx,{supplierName:n,supplierId:n,unitCostKopecks:0}); } }}
                        style={{ fontSize:10, border:"1px solid #ddd", borderRadius:4, padding:"2px 3px", color:"#888",
                          background: unique.some(m=>m.supplierName===l.supplierName)||isStock?"transparent":"rgba(200,154,52,.1)" }}>
                        <option value="">+ другой…</option>
                        {allSupplierNames.filter(n=>!unique.some(m=>m.supplierName===n)).map(n=><option key={n} value={n}>{n}</option>)}
                      </select>
                      {l.supplierName && (
                        <input type="text" inputMode="decimal" value={drafts.value(`cost-${l.idx}`, (l.unitCostKopecks/100).toFixed(2))}
                          onChange={e => {
                            const k = rubToKopecks(e.target.value, 0);
                            drafts.set(`cost-${l.idx}`, e.target.value, k !== null);
                            if (k !== null) patch(l.idx, { unitCostKopecks: k });
                          }}
                          onBlur={() => { if (!drafts.invalid(`cost-${l.idx}`)) drafts.clear(`cost-${l.idx}`); }}
                          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          style={{ width:62, textAlign:"right", border: drafts.invalid(`cost-${l.idx}`) ? "1px solid #C62828" : "1px solid #e0d8cc", borderRadius:4, padding:"2px 4px", fontSize:11, marginLeft:4 }} />
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign:"right", fontWeight:600, color:d>0?"#2E7D32":d<0?"#C62828":"#aaa" }}>
                    {l.qtyPacked>0 ? fmtRub(d) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding:"10px 16px", background:"#faf7f2", borderTop:"1px solid #e0d8cc" }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
          {Object.values(bySource).map(s => (
            <span key={s.name} style={{ fontSize:11, background:s.isStock?"rgba(46,125,50,.1)":"rgba(200,154,52,.1)", color:s.isStock?"#2E7D32":"#5A4A35", borderRadius:6, padding:"2px 8px" }}>
              {s.isStock?"🏪 Склад":s.name}{!s.isStock&&s.cost>0?`: ${fmtRub(s.cost)}`:""}
            </span>
          ))}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:12, lineHeight:1.8 }}>
            {costAll > 0 ? (
              <>
                <div style={{ color:"#5A4A35" }}>
                  Заказ: <b>{fmtRub(sellAll)}</b> · Закупка: <b>{fmtRub(costAll)}</b>
                  <span style={{ marginLeft:8, fontWeight:700, color:profitAll>=0?"#2E7D32":"#C62828" }}>
                    · Маржа: {fmtRub(profitAll)} ({sellAll>0?Math.round(profitAll/sellAll*100):0}%)
                  </span>
                </div>
                {packed > 0 && sell > 0 && (
                  <div style={{ color:"#888", fontSize:11 }}>
                    Упаковано: выручка {fmtRub(sell)} · закупка {fmtRub(cost)} · прибыль {fmtRub(profit)}
                  </div>
                )}
              </>
            ) : (
              <span style={{ color:"#aaa" }}>Выберите поставщика для расчёта маржи</span>
            )}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button className="go-btn" onClick={() => { clearTimeout(saveTimerRef.current); void persist(linesRef.current); }}
              disabled={!isDirty || saving}
              style={{ background: isDirty ? "#1565C0" : "#e0d8cc", color: isDirty ? "#fff" : "#aaa",
                borderColor: isDirty ? "#1565C0" : "#e0d8cc", cursor: isDirty ? "pointer" : "default" }}>
              {saving ? "сохр…" : "💾 Сохранить"}
            </button>
            {order.status === "approved" && (
              <button className="go-btn" onClick={() => void returnToReceived()}
                style={{ fontSize:11, color:"#757575", borderColor:"#ccc" }}>
                ← В заказы
              </button>
            )}
            {order.status === "sourcing" && (allSent ? (
              <>
                <span style={{ fontSize:12, color:"#2E7D32", alignSelf:"center" }}>✓ В закупке</span>
                <button className="go-btn" onClick={() => void resetPurchase()}
                  title="Сбросить закупку и выбрать поставщиков заново"
                  style={{ fontSize:11, color:"#8B6914", borderColor:"#c8a434" }}>
                  ↺ Сброс
                </button>
              </>
            ) : (
              <button className="go-btn go-btn--gold" onClick={() => void distribute()} disabled={!hasPending}>
                {hasPending ? "→ В закупку" : "Назначьте поставщика"}
              </button>
            ))}
            {order.status === "sourcing" && (
              <>
                <button className="go-btn" onClick={() => setShowUpd(true)}
                  style={{ fontSize: 11, color: "#8B6914", borderColor: "rgba(200,154,52,.5)" }}>
                  УПД
                </button>
                <button className="go-btn go-btn--green" onClick={() => void deliver()} disabled={shipping}>Отгрузить ✓</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    {showUpd && lines && (
      <UpdModal
        orderNum={order.id.slice(-6)}
        customerName={order.customerName}
        customerInn={(order as typeof order & { customerInn?: string }).customerInn}
        customerAddr={order.address}
        items={lines.map(l => {
          const qty = l.qtyPacked > 0 ? l.qtyPacked : l.qtyOrdered;
          const it = order.items[l.idx];
          // Полная позиция — итог строки из заказа до копейки (цена за ед. округлена)
          const full = it && !l.replaced && qty === itemQty(it);
          return {
            name: l.productName, qty, unit: "шт", price: l.unitSellKopecks / 100,
            totalKopecks: full ? itemTotalKopecks(it) : undefined,
            selected: l.qtyPacked > 0 || l.qtyOrdered > 0,
          } as UpdItem;
        })}
        onClose={() => setShowUpd(false)}
        onShip={() => { setShowUpd(false); void deliver(); }}
      />
    )}
    </>
  );
}
