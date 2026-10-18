import { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, query, orderBy } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub, loadPricelist } from "../useOrders";
import { parseQty, rubToKopecks } from "../numInput";
import { StockReceiptForm } from "./StockReceiptForm";

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
  const [balanceSearch, setBalanceSearch] = useState("");
  // regionTab — только когда region не задан (директор видит оба склада)
  const [regionTab, setRegionTab] = useState<"msk" | "spb">("msk");

  // оставляем для кнопки "Новый поставщик" в форме накладной
  const [saving, setSaving]       = useState(false);
  const [fSearch,   setFSearch]   = useState("");
  const [fQty,      setFQty]      = useState("");
  const [fCost,     setFCost]     = useState("");
  const [fNote,     setFNote]     = useState("");
  const [fProduct,  setFProduct]  = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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
        String(it.name ?? "").toLowerCase().includes(q) || String(it.barcode ?? "").includes(q)
      ).slice(0, 8).map(it => ({ productName: it.name, barcode: it.barcode == null ? null : String(it.barcode) }));
      setSuggestions(hits);
    });
  }, [fSearch]);

  const filteredSuppliers = useMemo(() => {
    const q = fSupplier.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s => s.toLowerCase().includes(q));
  }, [suppliers, fSupplier]);

  // effectiveRegion: если region задан (спб-менеджер) — фиксирован; иначе — по табу директора
  const effectiveRegion = region ?? regionTab;
  const regionEntries = entries.filter(e =>
    effectiveRegion === "spb" ? e.region === "spb" : (!e.region || e.region === "msk")
  );

  const balances = useMemo(() => {
    const map = new Map<string, Balance>();
    for (const e of [...regionEntries].reverse()) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionEntries]);

  const filteredBalances = useMemo(() => {
    const q = balanceSearch.toLowerCase();
    if (!q) return balances;
    return balances.filter(b =>
      String(b.productName ?? "").toLowerCase().includes(q) || String(b.barcode ?? "").includes(q)
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
    try {
      const id = slugify(newSupName.trim());
      await setDoc(doc(db, `tenants/${businessId}/suppliers`, id), {
        id, name: newSupName.trim(),
        phone: newSupPhone.trim() || null,
        cat: "", icon: "📦", section: "current", hasContract: false,
      });
      setFSupplier(newSupName.trim());
      setNewSupName(""); setNewSupPhone("");
      setShowNewSup(false); setSupOpen(false);
    } catch (e) {
      console.error("Supplier save failed:", e);
      alert("Ошибка сохранения: " + String(e));
    } finally {
      setSavingNewSup(false);
    }
  }

  // Количество: дробное (кг/л), точность 0,001, строго > 0
  const qtyValue   = parseQty(fQty);
  const qtyInvalid = fQty.trim() !== "" && qtyValue === null;
  const costValue  = rubToKopecks(fCost, 0);
  const costInvalid = costValue === null;

  async function save() {
    const product = fProduct ?? (fSearch.trim() ? { productName: fSearch.trim(), barcode: null } : null);
    if (!product || !fQty) return;
    if (qtyValue === null || costValue === null) return;
    setSaving(true);
    try {
      await addDoc(collection(db, `tenants/${businessId}/stock`), {
        productName:  product.productName,
        barcode:      product.barcode ?? null,
        qty:          qtyValue,
        supplierName: fSupplier.trim() || null,
        costKopecks:  costValue,
        note:         fNote || null,
        region:       region ?? null,
        createdAt:    new Date().toISOString(),
        createdBy:    currentUser,
      });
      resetForm();
      setShowForm(false);
    } catch (e) {
      console.error("Stock save failed:", e);
      alert("Ошибка сохранения: " + String(e));
    } finally {
      setSaving(false);
    }
  }

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#8B7355" }}>
          {balances.length} позиций · {effectiveRegion === "spb" ? "Склад Санкт-Петербург" : "Склад Москва"}
        </div>
        <button onClick={() => { resetForm(); setShowForm(v => !v); }}
          className="go-btn go-btn--gold">
          {showForm ? "Отмена" : "+ Приход"}
        </button>
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
      {regionEntries.length > 0 && (
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
              {regionEntries.slice(0, 20).map(e => (
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
