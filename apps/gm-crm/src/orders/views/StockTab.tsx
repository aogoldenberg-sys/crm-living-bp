import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub } from "../useOrders";
import { StockReceiptForm } from "./StockReceiptForm";
import { matchesRegion, normalizeRegion } from "../region";
import { round3 } from "../stockOps";

interface StockEntry {
  id: string;
  productName: string;
  barcode: string | null;
  qty: number;
  unit?: string;
  supplierName: string | null;
  batchId?: string | null;
  costKopecks: number;
  note: string | null;
  createdAt: string;
  createdBy: string;
  region: string | null;
}

interface Balance {
  key: string;
  productName: string;
  barcode: string | null;
  qty: number;
  unit: string;
  lastSupplier: string | null;
  lastCostKopecks: number;
  lastDate: string;
}

const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };
const TH: React.CSSProperties = { ...TD, fontWeight: 600, color: "#8B7355", fontSize: 11, whiteSpace: "nowrap" };


// Остатки из сырых записей. «Последний приход» — только по приходам (qty > 0), не по списаниям.
function computeBalances(entries: StockEntry[]): Balance[] {
  const map = new Map<string, Balance>();
  for (const e of [...entries].reverse()) {
    // тот же ключ, что у остатков сборки (stockOps): штрихкод, иначе название без учёта регистра
    const key = e.barcode ? String(e.barcode) : String(e.productName ?? "").toLowerCase();
    if (!map.has(key)) {
      map.set(key, { key, productName: e.productName, barcode: e.barcode, qty: 0, unit: e.unit || "шт", lastSupplier: null, lastCostKopecks: 0, lastDate: "" });
    }
    const b = map.get(key)!;
    b.qty = round3(b.qty + (Number(e.qty) || 0));
    if (e.qty > 0 && e.createdAt > b.lastDate) {
      b.lastDate = e.createdAt;
      b.lastSupplier = e.supplierName;
      b.lastCostKopecks = e.costKopecks;
      if (e.unit) b.unit = e.unit;
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty);
}

function exportStockCsv(entries: StockEntry[], regionFilter: "msk" | "spb", regionLabel: string) {
  const balances = computeBalances(entries.filter(e => matchesRegion(e, regionFilter))).filter(b => b.qty > 0);
  const rows = [
    ["Наименование", "Штрихкод", "Остаток", "Ед.", "Цена закупки (руб.)"],
    ...balances.map(b => [
      b.productName,
      b.barcode ?? "",
      String(b.qty),
      b.unit,
      b.lastCostKopecks > 0 ? (b.lastCostKopecks / 100).toFixed(2) : "",
    ]),
  ];
  const csv = "\uFEFF" + rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `склад_${regionLabel}_${new Date().toLocaleDateString("ru-RU").replace(/\./g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function StockTab({ businessId, currentUser, region }: { businessId: string; currentUser: string; region?: string }) {
  const [entries, setEntries]     = useState<StockEntry[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [showForm, setShowForm]   = useState(false);
  const [balanceSearch, setBalanceSearch] = useState("");
  const [regionTab, setRegionTab] = useState<"msk" | "spb">("msk");
  const [stockView, setStockView] = useState<"balance" | "receipts">("balance");
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  // Инлайн-редактирование записей
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<StockEntry>>({});

  async function saveEdit() {
    if (!editId) return;
    const ref = doc(db, `tenants/${businessId}/stock/${editId}`);
    await updateDoc(ref, {
      productName:  editDraft.productName ?? "",
      barcode:      editDraft.barcode?.trim() || null,
      qty:          Number(editDraft.qty) || 0,
      costKopecks:  Number(editDraft.costKopecks) || 0,
      supplierName: editDraft.supplierName?.trim() || null,
    });
    setEditId(null);
  }

  async function removeEntry(id: string) {
    if (!confirm("Удалить эту запись? Это изменит остаток на складе.")) return;
    await deleteDoc(doc(db, `tenants/${businessId}/stock/${id}`));
  }

  function startEdit(e: StockEntry) {
    setEditId(e.id);
    setEditDraft({ productName: e.productName, barcode: e.barcode ?? "", qty: e.qty, costKopecks: e.costKopecks, supplierName: e.supplierName ?? "" });
  }

  useEffect(() => {
    const q = query(collection(db, `tenants/${businessId}/stock`), orderBy("createdAt", "desc"));
    return onSnapshot(q, snap => {
      // Загружаем все записи; фильтрация по региону — в рендере (для директора переключается таб)
      setEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<StockEntry, "id">) })));
    });
  }, [businessId]);

  useEffect(() => {
    return onSnapshot(collection(db, `tenants/${businessId}/suppliers`), snap => {
      setSuppliers(
        snap.docs.map(d => (d.data() as { name?: string }).name ?? "").filter(Boolean).sort()
      );
    });
  }, [businessId]);

  // effectiveRegion: если region задан (спб-менеджер) — фиксирован; иначе — по табу директора
  const effectiveRegion = normalizeRegion(region ?? regionTab);
  const regionEntries = useMemo(
    () => entries.filter(e => matchesRegion(e, effectiveRegion)),
    [entries, effectiveRegion],
  );
  const balances = useMemo(() => computeBalances(regionEntries), [regionEntries]);

  const filteredBalances = useMemo(() => {
    const q = balanceSearch.toLowerCase();
    if (!q) return balances;
    return balances.filter(b =>
      String(b.productName ?? "").toLowerCase().includes(q) || String(b.barcode ?? "").includes(q)
    );
  }, [balances, balanceSearch]);

  // Группировка по накладным (batchId > note > дата+поставщик)
  const receiptGroups = useMemo(() => {
    const incomeEntries = regionEntries.filter(e => e.qty > 0);
    const map = new Map<string, { key: string; label: string; supplier: string | null; date: string; items: StockEntry[]; totalQty: number; totalCost: number }>();
    for (const e of incomeEntries) {
      const key = e.batchId ?? e.note ?? `${e.createdAt.slice(0, 10)}|${e.supplierName ?? ""}`;
      if (!map.has(key)) {
        const label = e.note ?? (e.batchId ? `Приход от ${new Date(e.createdAt).toLocaleDateString("ru-RU")}` : `Приход ${new Date(e.createdAt).toLocaleDateString("ru-RU")}`);
        map.set(key, { key, label, supplier: e.supplierName, date: e.createdAt, items: [], totalQty: 0, totalCost: 0 });
      }
      const g = map.get(key)!;
      g.items.push(e);
      g.totalQty += e.qty;
      g.totalCost += e.qty * (e.costKopecks || 0);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [regionEntries]);

  return (
    <div>
      {/* Переключатель склада — только для директора (region не задан) */}
      {!region && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button onClick={() => setRegionTab("msk")}
            style={{ padding: "5px 16px", borderRadius: 20, border: "1px solid #e0d8cc", fontSize: 12, cursor: "pointer",
              background: regionTab === "msk" ? "#C8963480" : "#faf8f4", fontWeight: regionTab === "msk" ? 700 : 400 }}>
            🏙 Склад Москва
          </button>
          <button onClick={() => setRegionTab("spb")}
            style={{ padding: "5px 16px", borderRadius: 20, border: "1px solid #e0d8cc", fontSize: 12, cursor: "pointer",
              background: regionTab === "spb" ? "#1565C080" : "#faf8f4", color: regionTab === "spb" ? "#fff" : undefined, fontWeight: regionTab === "spb" ? 700 : 400 }}>
            🌊 Склад СПб
          </button>
        </div>
      )}

      {/* Переключатель Остатки / Накладные */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button onClick={() => setStockView("balance")}
          style={{ padding: "5px 16px", borderRadius: 20, border: "1px solid #e0d8cc", fontSize: 12, cursor: "pointer",
            background: stockView === "balance" ? "#C8963480" : "#faf8f4", fontWeight: stockView === "balance" ? 700 : 400 }}>
          📦 Остатки
        </button>
        <button onClick={() => setStockView("receipts")}
          style={{ padding: "5px 16px", borderRadius: 20, border: "1px solid #e0d8cc", fontSize: 12, cursor: "pointer",
            background: stockView === "receipts" ? "#C8963480" : "#faf8f4", fontWeight: stockView === "receipts" ? 700 : 400 }}>
          📋 Накладные ({receiptGroups.length})
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#8B7355" }}>
          {stockView === "balance"
            ? `${balances.length} позиций · ${effectiveRegion === "spb" ? "Склад Санкт-Петербург" : "Склад Москва"}`
            : `${receiptGroups.length} накладных · ${effectiveRegion === "spb" ? "Склад Санкт-Петербург" : "Склад Москва"}`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {entries.length > 0 && !region && (
            <>
              <button
                onClick={() => exportStockCsv(entries, "msk", "Москва")}
                style={{ padding: "6px 14px", fontSize: 12, borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
                  border: "1px solid rgba(200,154,52,.4)", background: "transparent", color: "#8B6914" }}>
                ⬇ МСК
              </button>
              <button
                onClick={() => exportStockCsv(entries, "spb", "СПб")}
                style={{ padding: "6px 14px", fontSize: 12, borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
                  border: "1px solid rgba(21,101,192,.4)", background: "transparent", color: "#1565C0" }}>
                ⬇ СПб
              </button>
            </>
          )}
          {entries.length > 0 && region && (
            <button
              onClick={() => exportStockCsv(entries, effectiveRegion, effectiveRegion === "spb" ? "СПб" : "Москва")}
              style={{ padding: "6px 14px", fontSize: 12, borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
                border: "1px solid rgba(200,154,52,.4)", background: "transparent", color: "#8B6914" }}>
              ⬇ Выгрузить CSV
            </button>
          )}
          <button onClick={() => setShowForm(v => !v)}
            className="go-btn go-btn--gold">
            {showForm ? "Отмена" : "+ Приход"}
          </button>
        </div>
      </div>

      {showForm && (
        <StockReceiptForm
          businessId={businessId}
          currentUser={currentUser}
          region={effectiveRegion}
          suppliers={suppliers}
          onSaved={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {stockView === "receipts" && (
        <div>
          {receiptGroups.length === 0 && (
            <div style={{ color: "#aaa", fontSize: 13, padding: 24, textAlign: "center" }}>Накладных нет</div>
          )}
          {receiptGroups.map(g => (
            <div key={g.key} style={{ border: "1px solid #e0d8cc", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", background: "#faf8f4", cursor: "pointer" }}
                onClick={() => setExpandedBatch(expandedBatch === g.key ? null : g.key)}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{g.label}</span>
                  {g.supplier && <span style={{ marginLeft: 10, fontSize: 12, color: "#8B7355" }}>{g.supplier}</span>}
                  <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa" }}>{new Date(g.date).toLocaleDateString("ru-RU")}</span>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
                  <span style={{ color: "#555" }}>{g.items.length} поз. · {g.totalQty} шт</span>
                  <span style={{ fontWeight: 700, color: "#2E7D32" }}>{fmtRub(g.totalCost)}</span>
                  <span style={{ color: "#aaa" }}>{expandedBatch === g.key ? "▲" : "▼"}</span>
                </div>
              </div>
              {expandedBatch === g.key && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f5f0e8", borderBottom: "1px solid #e0d8cc" }}>
                      <th style={{ ...TH, textAlign: "left" }}>Наименование</th>
                      <th style={{ ...TH }}>Штрихкод</th>
                      <th style={{ ...TH, textAlign: "right" }}>Кол-во</th>
                      <th style={{ ...TH }}>Ед.</th>
                      <th style={{ ...TH, textAlign: "right" }}>Цена</th>
                      <th style={{ ...TH, textAlign: "right" }}>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(e => (
                      <tr key={e.id} style={{ borderBottom: "1px solid #f5f0e8" }}>
                        <td style={{ ...TD, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.productName}</td>
                        <td style={{ ...TD, fontFamily: "monospace", fontSize: 10, color: e.barcode ? "#555" : "#ccc" }}>{e.barcode ?? "—"}</td>
                        <td style={{ ...TD, textAlign: "right", fontWeight: 600 }}>{e.qty}</td>
                        <td style={{ ...TD, color: "#777" }}>{e.unit ?? "шт"}</td>
                        <td style={{ ...TD, textAlign: "right", color: "#555" }}>{e.costKopecks > 0 ? fmtRub(e.costKopecks) : "—"}</td>
                        <td style={{ ...TD, textAlign: "right", fontWeight: 600, color: "#2E7D32" }}>{e.costKopecks > 0 ? fmtRub(e.qty * e.costKopecks) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {stockView === "balance" && <>
      {/* Поиск по остаткам */}
      <input
        placeholder="Поиск по названию или штрихкоду…"
        value={balanceSearch}
        onChange={e => setBalanceSearch(e.target.value)}
        style={{ width: "100%", marginBottom: 12, padding: "8px 12px",
          fontSize: 13, border: "1px solid #e0d8cc", borderRadius: 8,
          background: "#faf8f4", boxSizing: "border-box" }}
      />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
          <thead>
            <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
              <th style={TH}>Наименование</th>
              <th style={TH}>Штрихкод</th>
              <th style={{ ...TH, textAlign: "right" }}>Остаток</th>
              <th style={{ ...TH, textAlign: "right" }}>Цена закупки</th>
              <th style={TH}>Поставщик</th>
              <th style={TH}>Последний приход</th>
            </tr>
          </thead>
          <tbody>
            {filteredBalances.length === 0
              ? <tr><td colSpan={6} style={{ ...TD, color: "#aaa", textAlign: "center", padding: 24 }}>Остатков нет</td></tr>
              : filteredBalances.map(b => (
                <tr key={b.key} style={{ borderBottom: "1px solid #f0ece5" }}>
                  <td style={{ ...TD, fontWeight: 500, maxWidth: 240,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.productName}
                  </td>
                  <td style={{ ...TD, fontFamily: "monospace", fontSize: 10, color: "#888" }}>
                    {b.barcode ?? "—"}
                  </td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 700,
                    color: b.qty <= 0 ? "#C62828" : b.qty < 10 ? "#E65100" : "#2E7D32" }}>
                    {b.qty}
                  </td>
                  <td style={{ ...TD, textAlign: "right", color: "#555" }}>
                    {b.lastCostKopecks > 0 ? fmtRub(b.lastCostKopecks) : "—"}
                  </td>
                  <td style={{ ...TD, color: "#777", fontSize: 11,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                    {b.lastSupplier ?? "—"}
                  </td>
                  <td style={{ ...TD, color: "#aaa", fontSize: 11 }}>
                    {b.lastDate ? new Date(b.lastDate).toLocaleDateString("ru-RU") : "—"}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Последние записи — редактируемые */}
      {regionEntries.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8B7355",
            textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
            Последние записи
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
                <th style={TH}>Дата</th>
                <th style={TH}>Товар</th>
                <th style={{ ...TH, width: 120 }}>Штрихкод</th>
                <th style={{ ...TH, textAlign: "right", width: 60 }}>Кол-во</th>
                <th style={{ ...TH, textAlign: "right", width: 90 }}>Цена</th>
                <th style={TH}>Поставщик</th>
                <th style={TH}>Примечание</th>
                <th style={{ width: 64 }} />
              </tr>
            </thead>
            <tbody>
              {regionEntries.slice(0, 50).map(e => {
                const inp: React.CSSProperties = { width: "100%", border: "none",
                  borderBottom: "1px solid #C89A34", background: "#fffdf7",
                  fontSize: 12, padding: "1px 2px", outline: "none" };
                if (editId === e.id) return (
                  <tr key={e.id} style={{ background: "#fffdf7", borderBottom: "1px solid #e0d8cc" }}>
                    <td style={{ ...TD, color: "#888", whiteSpace: "nowrap" }}>
                      {new Date(e.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                    <td style={{ ...TD, minWidth: 160 }}>
                      <input style={inp} value={editDraft.productName ?? ""}
                        onChange={ev => setEditDraft(p => ({ ...p, productName: ev.target.value }))} />
                    </td>
                    <td style={TD}>
                      <input style={{ ...inp, fontFamily: "monospace" }}
                        value={editDraft.barcode ?? ""}
                        placeholder="штрихкод"
                        onChange={ev => setEditDraft(p => ({ ...p, barcode: ev.target.value }))} />
                    </td>
                    <td style={TD}>
                      <input style={{ ...inp, textAlign: "right" }} inputMode="decimal"
                        value={String(editDraft.qty ?? "")}
                        onChange={ev => setEditDraft(p => ({ ...p, qty: Number(ev.target.value) }))} />
                    </td>
                    <td style={TD}>
                      <input style={{ ...inp, textAlign: "right" }} inputMode="decimal"
                        value={String(editDraft.costKopecks ?? "")}
                        placeholder="коп."
                        onChange={ev => setEditDraft(p => ({ ...p, costKopecks: Number(ev.target.value) }))} />
                    </td>
                    <td style={TD}>
                      <input style={inp} value={editDraft.supplierName ?? ""}
                        onChange={ev => setEditDraft(p => ({ ...p, supplierName: ev.target.value }))} />
                    </td>
                    <td style={{ ...TD, color: "#aaa" }}>{e.note ?? "—"}</td>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>
                      <button onClick={() => void saveEdit()}
                        style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, border: "none",
                          background: "#2E7D32", color: "#fff", cursor: "pointer", marginRight: 3 }}>
                        ✓
                      </button>
                      <button onClick={() => setEditId(null)}
                        style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, border: "1px solid #ddd",
                          background: "#fff", cursor: "pointer" }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid #f0ece5" }}>
                    <td style={{ ...TD, color: "#888", whiteSpace: "nowrap" }}>
                      {new Date(e.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                    <td style={{ ...TD, maxWidth: 200,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.productName}
                    </td>
                    <td style={{ ...TD, fontFamily: "monospace", fontSize: 10, color: e.barcode ? "#555" : "#ccc" }}>
                      {e.barcode ?? "—"}
                    </td>
                    <td style={{ ...TD, textAlign: "right", fontWeight: 600,
                      color: e.qty >= 0 ? "#2E7D32" : "#C62828" }}>
                      {e.qty >= 0 ? "+" : ""}{round3(e.qty)}
                    </td>
                    <td style={{ ...TD, textAlign: "right", color: "#555" }}>
                      {e.costKopecks > 0 ? fmtRub(e.costKopecks) : "—"}
                    </td>
                    <td style={{ ...TD, color: "#777", fontSize: 11 }}>{e.supplierName ?? "—"}</td>
                    <td style={{ ...TD, color: "#aaa", fontSize: 11 }}>{e.note ?? "—"}</td>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>
                      <button onClick={() => startEdit(e)} title="Редактировать"
                        style={{ fontSize: 11, padding: "2px 6px", borderRadius: 5, border: "1px solid #ddd",
                          background: "#fff", cursor: "pointer", marginRight: 3 }}>
                        ✏
                      </button>
                      <button onClick={() => void removeEntry(e.id)} title="Удалить"
                        style={{ fontSize: 11, padding: "2px 6px", borderRadius: 5, border: "1px solid #fdd",
                          background: "#fff", color: "#C62828", cursor: "pointer" }}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
