import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub } from "../useOrders";
import { StockReceiptForm } from "./StockReceiptForm";

interface StockEntry {
  id: string;
  productName: string;
  barcode: string | null;
  qty: number;
  unit?: string;
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
  unit: string;
  lastSupplier: string | null;
  lastCostKopecks: number;
  lastDate: string;
}

const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };
const TH: React.CSSProperties = { ...TD, fontWeight: 600, color: "#8B7355", fontSize: 11, whiteSpace: "nowrap" };


function exportStockCsv(entries: StockEntry[], regionFilter: "msk" | "spb", regionLabel: string) {
  // Считаем остатки по нужному складу из сырых записей
  const filtered = entries.filter(e =>
    regionFilter === "spb" ? e.region === "spb" : (!e.region || e.region === "msk")
  );
  const map = new Map<string, Balance>();
  for (const e of [...filtered].reverse()) {
    const key = e.barcode || e.productName;
    if (!map.has(key)) {
      map.set(key, { key, productName: e.productName, barcode: e.barcode, qty: 0, unit: e.unit || "шт", lastSupplier: null, lastCostKopecks: 0, lastDate: "" });
    }
    const b = map.get(key)!;
    b.qty += e.qty;
    if (e.createdAt > b.lastDate) {
      b.lastDate = e.createdAt;
      b.lastSupplier = e.supplierName;
      b.lastCostKopecks = e.costKopecks;
      if (e.unit) b.unit = e.unit;
    }
  }
  const balances = [...map.values()].filter(b => b.qty > 0).sort((a, b) => b.qty - a.qty);
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
  // regionTab — только когда region не задан (директор видит оба склада)
  const [regionTab, setRegionTab] = useState<"msk" | "spb">("msk");

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
  const effectiveRegion = region ?? regionTab;
  const regionEntries = entries.filter(e =>
    effectiveRegion === "spb" ? e.region === "spb" : (!e.region || e.region === "msk")
  );

  const balances = useMemo(() => {
    const map = new Map<string, Balance>();
    for (const e of [...regionEntries].reverse()) {
      const key = e.barcode || e.productName;
      if (!map.has(key)) {
        map.set(key, { key, productName: e.productName, barcode: e.barcode, qty: 0, unit: e.unit || "шт", lastSupplier: null, lastCostKopecks: 0, lastDate: "" });
      }
      const b = map.get(key)!;
      b.qty += e.qty;
      if (e.createdAt > b.lastDate) {
        b.lastDate         = e.createdAt;
        b.lastSupplier     = e.supplierName;
        b.lastCostKopecks  = e.costKopecks;
        if (e.unit) b.unit = e.unit;
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
              onClick={() => exportStockCsv(entries, region as "msk" | "spb", region === "spb" ? "СПб" : "Москва")}
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
