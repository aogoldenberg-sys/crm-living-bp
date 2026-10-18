import { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, addDoc, doc, setDoc, query, orderBy } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub, loadPricelist } from "../useOrders";

interface StockEntry {
  id: string;
  productName: string;
  barcode: string | null;
  qty: number;
  supplierName: string | null;
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
  lastSupplier: string | null;
  lastCostKopecks: number;
  lastDate: string;
}

interface Suggestion { productName: string; barcode: string | null }

const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };
const TH: React.CSSProperties = { ...TD, fontWeight: 600, color: "#8B7355", fontSize: 11, whiteSpace: "nowrap" };

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "_").slice(0, 30);
}

// Блокируем нечисловые клавиши в поле цены (e, +, -)
function numericKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
}

export function StockTab({ businessId, currentUser, region }: { businessId: string; currentUser: string; region?: string }) {
  const [entries, setEntries]     = useState<StockEntry[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);

  // форма — товар
  const [fSearch,   setFSearch]   = useState("");
  const [fQty,      setFQty]      = useState("");
  const [fCost,     setFCost]     = useState("");
  const [fNote,     setFNote]     = useState("");
  const [fProduct,  setFProduct]  = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [balanceSearch, setBalanceSearch] = useState("");

  // форма — поставщик (combobox)
  const [fSupplier,    setFSupplier]    = useState("");
  const [supOpen,      setSupOpen]      = useState(false);
  const [showNewSup,   setShowNewSup]   = useState(false);
  const [newSupName,   setNewSupName]   = useState("");
  const [newSupPhone,  setNewSupPhone]  = useState("");
  const [savingNewSup, setSavingNewSup] = useState(false);
  const supRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, `tenants/${businessId}/stock`), orderBy("createdAt", "desc"));
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<StockEntry, "id">) }));
      // region=undefined → Москва (null/msk/старые записи); region="spb" → только СПб
      setEntries(region ? all.filter(e => e.region === region) : all.filter(e => !e.region || e.region === "msk"));
    });
  }, [businessId, region]);

  useEffect(() => {
    return onSnapshot(collection(db, `tenants/${businessId}/suppliers`), snap => {
      setSuppliers(
        snap.docs.map(d => (d.data() as { name?: string }).name ?? "").filter(Boolean).sort()
      );
    });
  }, [businessId]);

  // Закрываем dropdown поставщика по клику вне
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (supRef.current && !supRef.current.contains(e.target as Node)) {
        setSupOpen(false);
        setShowNewSup(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Поиск товара из прайса
  useEffect(() => {
    const q = fSearch.trim().toLowerCase();
    if (q.length < 2) { setSuggestions([]); return; }
    loadPricelist().then(pl => {
      const hits = pl.filter(it =>
        it.name.toLowerCase().includes(q) || (it.barcode ?? "").includes(q)
      ).slice(0, 8).map(it => ({ productName: it.name, barcode: it.barcode }));
      setSuggestions(hits);
    });
  }, [fSearch]);

  const filteredSuppliers = useMemo(() => {
    const q = fSupplier.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s => s.toLowerCase().includes(q));
  }, [suppliers, fSupplier]);

  const balances = useMemo(() => {
    const map = new Map<string, Balance>();
    for (const e of [...entries].reverse()) {
      const key = e.barcode || e.productName;
      if (!map.has(key)) {
        map.set(key, { key, productName: e.productName, barcode: e.barcode, qty: 0, lastSupplier: null, lastCostKopecks: 0, lastDate: "" });
      }
      const b = map.get(key)!;
      b.qty += e.qty;
      if (e.createdAt > b.lastDate) {
        b.lastDate         = e.createdAt;
        b.lastSupplier     = e.supplierName;
        b.lastCostKopecks  = e.costKopecks;
      }
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty);
  }, [entries]);

  const filteredBalances = useMemo(() => {
    const q = balanceSearch.toLowerCase();
    if (!q) return balances;
    return balances.filter(b =>
      b.productName.toLowerCase().includes(q) || (b.barcode ?? "").includes(q)
    );
  }, [balances, balanceSearch]);

  function resetForm() {
    setFSearch(""); setFQty(""); setFCost(""); setFNote("");
    setFProduct(null); setSuggestions([]);
    setFSupplier(""); setSupOpen(false); setShowNewSup(false);
    setNewSupName(""); setNewSupPhone("");
  }

  async function saveNewSupplier() {
    if (!newSupName.trim()) return;
    setSavingNewSup(true);
    const id = slugify(newSupName.trim());
    await setDoc(doc(db, `tenants/${businessId}/suppliers`, id), {
      id, name: newSupName.trim(),
      phone: newSupPhone.trim() || null,
      cat: "", icon: "📦", section: "current", hasContract: false,
    });
    setFSupplier(newSupName.trim());
    setNewSupName(""); setNewSupPhone("");
    setShowNewSup(false); setSupOpen(false);
    setSavingNewSup(false);
  }

  async function save() {
    const product = fProduct ?? (fSearch.trim() ? { productName: fSearch.trim(), barcode: null } : null);
    if (!product || !fQty) return;
    setSaving(true);
    await addDoc(collection(db, `tenants/${businessId}/stock`), {
      productName:  product.productName,
      barcode:      product.barcode ?? null,
      qty:          parseFloat(fQty),
      supplierName: fSupplier.trim() || null,
      costKopecks:  fCost ? Math.round(parseFloat(fCost) * 100) : 0,
      note:         fNote || null,
      region:       region ?? null,
      createdAt:    new Date().toISOString(),
      createdBy:    currentUser,
    });
    resetForm();
    setShowForm(false);
    setSaving(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#8B7355" }}>
          {balances.length} позиций · {region === "spb" ? "Склад Санкт-Петербург" : "Склад Москва"}
        </div>
        <button onClick={() => { resetForm(); setShowForm(v => !v); }}
          className="go-btn go-btn--gold">
          {showForm ? "Отмена" : "+ Приход"}
        </button>
      </div>

      {showForm && (
        <div className="go-form" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#3A2E1E" }}>Приход товара</h3>

          {/* Поиск товара */}
          <div className="go-field" style={{ position: "relative" }}>
            <label>Товар (штрихкод или название)</label>
            <input
              value={fProduct ? fProduct.productName : fSearch}
              onChange={e => { setFProduct(null); setFSearch(e.target.value); }}
              placeholder="Начните вводить…"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
            {fProduct && (
              <button onClick={() => { setFProduct(null); setFSearch(""); }}
                style={{ position: "absolute", right: 8, top: 32, background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 16 }}>×</button>
            )}
            {suggestions.length > 0 && !fProduct && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff",
                border: "1px solid #e0d8cc", borderRadius: 8, zIndex: 50, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.1)" }}>
                {suggestions.map((s, i) => (
                  <div key={i} onClick={() => { setFProduct(s); setSuggestions([]); }}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #f5f0e8" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#faf8f4")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <div style={{ fontWeight: 500 }}>{s.productName}</div>
                    {s.barcode && <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>{s.barcode}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div className="go-field">
              <label>Количество</label>
              <input type="number" min="0" step="1" inputMode="numeric"
                value={fQty} onKeyDown={numericKeyDown}
                onChange={e => setFQty(e.target.value)} placeholder="0" />
            </div>
            <div className="go-field">
              <label>Цена закупки (₽/шт)</label>
              <input type="number" min="0" step="0.01" inputMode="decimal"
                value={fCost} onKeyDown={numericKeyDown}
                onChange={e => setFCost(e.target.value)} placeholder="0" />
            </div>

            {/* Поставщик — combobox */}
            <div className="go-field" style={{ position: "relative" }} ref={supRef}>
              <label>Поставщик</label>
              <input
                value={fSupplier}
                onChange={e => { setFSupplier(e.target.value); setSupOpen(true); setShowNewSup(false); }}
                onFocus={() => setSupOpen(true)}
                placeholder="Начните вводить…"
                style={{ width: "100%", boxSizing: "border-box" }}
                autoComplete="off"
              />
              {fSupplier && (
                <button onClick={() => { setFSupplier(""); setSupOpen(false); setShowNewSup(false); }}
                  style={{ position: "absolute", right: 8, top: 32, background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 16 }}>×</button>
              )}
              {supOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff",
                  border: "1px solid #e0d8cc", borderRadius: 8, zIndex: 60, maxHeight: 240, overflowY: "auto",
                  boxShadow: "0 4px 16px rgba(0,0,0,.1)" }}>
                  {filteredSuppliers.map((s, i) => (
                    <div key={i}
                      onMouseDown={() => { setFSupplier(s); setSupOpen(false); }}
                      style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #f5f0e8" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#faf8f4")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      {s}
                    </div>
                  ))}
                  {/* Кнопка нового поставщика */}
                  <div
                    onMouseDown={() => { setShowNewSup(true); setSupOpen(false); }}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12,
                      color: "#C89A34", fontWeight: 600, borderTop: "1px solid #e0d8cc",
                      background: "#fffdf7" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#faf8f4")}
                    onMouseLeave={e => (e.currentTarget.style.background = "#fffdf7")}>
                    + Новый поставщик
                  </div>
                </div>
              )}

              {/* Мини-форма нового поставщика */}
              {showNewSup && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 70,
                  background: "#fff", border: "1px solid #e0d8cc", borderRadius: 10,
                  boxShadow: "0 4px 20px rgba(0,0,0,.15)", padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#3A2E1E", marginBottom: 10 }}>Новый поставщик</div>
                  <div className="go-field" style={{ marginBottom: 8 }}>
                    <label>Название *</label>
                    <input value={newSupName} onChange={e => setNewSupName(e.target.value)}
                      placeholder="ООО Поставщик…" autoFocus
                      style={{ width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div className="go-field" style={{ marginBottom: 10 }}>
                    <label>Телефон</label>
                    <input value={newSupPhone} onChange={e => setNewSupPhone(e.target.value)}
                      placeholder="+7…" style={{ width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="go-btn go-btn--gold" style={{ fontSize: 12, padding: "6px 14px" }}
                      onClick={() => void saveNewSupplier()} disabled={savingNewSup || !newSupName.trim()}>
                      {savingNewSup ? "…" : "Добавить"}
                    </button>
                    <button onClick={() => { setShowNewSup(false); setNewSupName(""); setNewSupPhone(""); }}
                      style={{ fontSize: 12, padding: "6px 12px", background: "none", border: "1px solid #e0d8cc",
                        borderRadius: 8, cursor: "pointer", color: "#8B7355" }}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="go-field">
              <label>Примечание</label>
              <input value={fNote} onChange={e => setFNote(e.target.value)} placeholder="Накладная №…" />
            </div>
          </div>

          <button className="go-btn go-btn--gold" style={{ marginTop: 12 }}
            onClick={() => void save()}
            disabled={saving || !fQty || (!fProduct && !fSearch.trim())}>
            {saving ? "Сохранение…" : "Сохранить приход"}
          </button>
        </div>
      )}

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

      {/* Последние приходы */}
      {entries.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8B7355",
            textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
            Последние записи
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
                <th style={TH}>Дата</th>
                <th style={TH}>Товар</th>
                <th style={{ ...TH, textAlign: "right" }}>Кол-во</th>
                <th style={{ ...TH, textAlign: "right" }}>Цена</th>
                <th style={TH}>Поставщик</th>
                <th style={TH}>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 20).map(e => (
                <tr key={e.id} style={{ borderBottom: "1px solid #f0ece5" }}>
                  <td style={{ ...TD, color: "#888", whiteSpace: "nowrap" }}>
                    {new Date(e.createdAt).toLocaleDateString("ru-RU")}
                  </td>
                  <td style={{ ...TD, maxWidth: 200,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.productName}
                  </td>
                  <td style={{ ...TD, textAlign: "right", fontWeight: 600,
                    color: e.qty >= 0 ? "#2E7D32" : "#C62828" }}>
                    {e.qty >= 0 ? "+" : ""}{e.qty}
                  </td>
                  <td style={{ ...TD, textAlign: "right", color: "#555" }}>
                    {e.costKopecks > 0 ? fmtRub(e.costKopecks) : "—"}
                  </td>
                  <td style={{ ...TD, color: "#777", fontSize: 11 }}>{e.supplierName ?? "—"}</td>
                  <td style={{ ...TD, color: "#aaa", fontSize: 11 }}>{e.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
