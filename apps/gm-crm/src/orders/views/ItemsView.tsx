import { useState, useMemo } from "react";
import { fmtRub, useOrders } from "../useOrders";
import { StockTab } from "./StockTab";
import { matchesRegion } from "../region";
import { itemQty, itemTotalKopecks } from "../money";
import { useAuth } from "../../auth/useAuth";

interface ItemStat {
  key: string;           // barcode || productName
  productName: string;
  barcode: string | null;
  orderCount: number;    // в скольких заказах встречается
  totalQty: number;      // суммарное количество штук
  totalRevKopecks: number; // суммарная выручка (unitPrice × qty)
  customers: Set<string>;
  lastDate: string;
  orders: { orderId: string; customerName: string; qty: number; date: string }[];
}

type Sort = "orders" | "qty" | "rev" | "name";

const TH: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", color: "#8B7355",
  fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", cursor: "pointer",
};
const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };

type Tab = "top" | "stock";

export function ItemsView({ businessId, regionFilter }: { businessId: string; regionFilter?: string }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("top");
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState<Sort>("orders");
  const [selected, setSelected] = useState<ItemStat | null>(null);

  // Статистика по всей истории: живые заказы + архив однократно (без живой подписки на всю коллекцию)
  const { orders, loading } = useOrders(businessId, "director", "", { archive: true });
  const items = useMemo(() => {
    const map = new Map<string, ItemStat>();

    orders.forEach(o => {
      if (!o.items?.length) return;
      if (!matchesRegion(o, regionFilter)) return;
      const date = o.deliveryDate ?? o.createdAt?.slice(0, 10) ?? "";

      o.items.forEach(item => {
        const key = item.barcode || item.productName;
        if (!map.has(key)) {
          map.set(key, {
            key, productName: item.productName,
            barcode: item.barcode ?? null,
            orderCount: 0, totalQty: 0, totalRevKopecks: 0,
            customers: new Set(), lastDate: date, orders: [],
          });
        }
        const s = map.get(key)!;
        s.orderCount++;
        s.totalQty += itemQty(item);
        s.totalRevKopecks += itemTotalKopecks(item);
        s.customers.add(o.customerName);
        if (date > s.lastDate) s.lastDate = date;
        s.orders.push({
          orderId: o.id,
          customerName: o.customerName,
          qty: itemQty(item),
          date,
        });
      });
    });

    return [...map.values()];
  }, [orders, regionFilter]);

  const sorted = useMemo(() => {
    const q = search.toLowerCase();
    let list = search
      ? items.filter(i =>
          i.productName.toLowerCase().includes(q) ||
          String(i.barcode ?? "").includes(q)
        )
      : [...items];

    list.sort((a, b) => {
      if (sort === "orders") return b.orderCount - a.orderCount;
      if (sort === "qty")    return b.totalQty - a.totalQty;
      if (sort === "rev")    return b.totalRevKopecks - a.totalRevKopecks;
      return a.productName.localeCompare(b.productName, "ru");
    });
    return list;
  }, [items, sort, search]);

  function SortBtn({ id, label }: { id: Sort; label: string }) {
    return (
      <th style={{ ...TH, color: sort === id ? "#5A3A1A" : "#8B7355" }}
        onClick={() => setSort(id)}>
        {label}{sort === id ? " ▼" : ""}
      </th>
    );
  }

  if (loading) return <div className="go-main"><div className="go-empty">Загрузка…</div></div>;

  if (selected) {
    const byDate = [...selected.orders].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="go-main">
        <button onClick={() => setSelected(null)}
          style={{ marginBottom: 16, fontSize: 12, cursor: "pointer",
            background: "none", border: "none", color: "#8B6914" }}>
          ← Все позиции
        </button>

        <div style={{ background: "#fff", border: "1px solid rgba(200,154,52,.25)",
          borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#3A2E1E", marginBottom: 6 }}>
            {selected.productName}
          </div>
          {selected.barcode && (
            <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace", marginBottom: 8 }}>
              {selected.barcode}
            </div>
          )}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            <span>📦 <b>{selected.orderCount}</b> заказов</span>
            <span>🔢 <b>{selected.totalQty}</b> шт суммарно</span>
            <span>👥 <b>{selected.customers.size}</b> клиентов</span>
            {selected.totalRevKopecks > 0 && (
              <span>💰 <b style={{ color: "#2E7D32" }}>{fmtRub(selected.totalRevKopecks)}</b> выручка</span>
            )}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
              <th style={TH}>Дата</th>
              <th style={TH}>Клиент</th>
              <th style={{ ...TH, textAlign: "right" }}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {byDate.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0ece5" }}>
                <td style={{ ...TD, color: "#888" }}>{r.date || "—"}</td>
                <td style={TD}>{r.customerName}</td>
                <td style={{ ...TD, textAlign: "right", fontWeight: 600 }}>{r.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "7px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: "none", borderBottom: tab === t ? "2px solid #C89A34" : "2px solid transparent",
    background: "transparent", color: tab === t ? "#5A3A1A" : "#8B7355",
  });

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Товары · {regionFilter === "spb" ? "Санкт-Петербург" : "Густорико"}</h1>
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e0d8cc", marginBottom: 20 }}>
        <button style={tabStyle("top")} onClick={() => setTab("top")}>📊 Топ продаж</button>
        <button style={tabStyle("stock")} onClick={() => setTab("stock")}>🏭 Склад</button>
      </div>

      {tab === "stock" && (
        <StockTab businessId={businessId} currentUser={user?.email ?? ""} region={regionFilter} />
      )}

      {tab === "top" && <>
        <input
          placeholder="Поиск по названию или штрихкоду…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: "100%", marginBottom: 12, padding: "8px 12px",
            fontSize: 13, border: "1px solid #e0d8cc", borderRadius: 8,
            background: "#faf8f4", boxSizing: "border-box" }}
        />
        <div style={{ fontSize: 12, color: "#8B7355", marginBottom: 10 }}>
          {sorted.length} позиций · клик по колонке = сортировка · клик по строке = история
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
                <th style={{ ...TH, width: 28 }}>#</th>
                <SortBtn id="name"   label="Наименование" />
                <th style={TH}>Штрихкод</th>
                <SortBtn id="orders" label="Заказов" />
                <SortBtn id="qty"    label="Шт всего" />
                <th style={TH}>Клиентов</th>
                <SortBtn id="rev"    label="Выручка" />
                <th style={TH}>Последний</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((it, idx) => (
                <tr key={it.key}
                  onClick={() => setSelected(it)}
                  style={{ borderBottom: "1px solid #f0ece5", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#faf8f4")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td style={{ ...TD, color: "#bbb", textAlign: "center" }}>{idx + 1}</td>
                  <td style={{ ...TD, fontWeight: 500, maxWidth: 260,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.productName}
                  </td>
                  <td style={{ ...TD, fontFamily: "monospace", fontSize: 10, color: "#888" }}>
                    {it.barcode ?? "—"}
                  </td>
                  <td style={{ ...TD, textAlign: "center", fontWeight: 700, color: "#5A3A1A" }}>
                    {it.orderCount}
                  </td>
                  <td style={{ ...TD, textAlign: "center" }}>{it.totalQty}</td>
                  <td style={{ ...TD, textAlign: "center", color: "#777" }}>
                    {it.customers.size}
                  </td>
                  <td style={{ ...TD, textAlign: "right", color: it.totalRevKopecks > 0 ? "#2E7D32" : "#bbb" }}>
                    {it.totalRevKopecks > 0 ? fmtRub(it.totalRevKopecks) : "—"}
                  </td>
                  <td style={{ ...TD, color: "#aaa", fontSize: 11 }}>{it.lastDate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
