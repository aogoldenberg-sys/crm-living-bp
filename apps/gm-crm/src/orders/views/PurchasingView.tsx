import { useState } from "react";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import {
  useOrders, usePurchaseOrders, usePricelistLookup, statusLabel, statusColor, fmtRub,
  type Order, type OrderItem,
} from "../useOrders";
import { PurchaseLinesSection } from "./PurchaseLinesSection";
import "../orders.css";

interface Props { businessId: string; clientFilter?: string | null; regionFilter?: string; }

const SUPPLIER_NAMES: Record<string, string> = {
  metro:       "Метро Cash&Carry",
  baykal:      "Байкал (Baikal)",
  skopinsky:   "Скопинский МПК",
  profitс:     "Профитс (Русина)",
  pikpak:      "Пик пак (ПиР-ПАК)",
  tander:      "Тандер (Магнит)",
  pervym:      "Первым Делом",
  letok:       "ЛетоК",
  apexfood:    "ApexFood",
  ashkudi:     "Ашкуди Энерджи",
  murat:       "Мурат / Ярмарка",
  tdprodvey:   "ТД Продвей",
  ifg:         "Интерфуд Групп (IFG)",
  greatgreen:  "Great Green",
  napitki_opt: "Напитки Оптом",
  bockarev:    "Пивоварни Бочкарев",
  moltreid:    "Молтрейд / Фреш Фуд",
  kurskiy:     "Курский молочный завод",
  knorr:       "Кнорр / Hellmann's",
  chupa:       "Чупа Лэнд",
  other:       "Другой поставщик",
};

const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Черновик", sent: "Отправлен", confirmed: "Подтверждён", delivered: "Получен",
};

function ItemsTable({ items, businessId }: { items: OrderItem[]; businessId: string }) {
  const lookup = usePricelistLookup(businessId, items);
  if (items.length === 0) return <span style={{ fontSize: 12, color: "#aaa" }}>нет позиций</span>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #e0d8cc" }}>
          <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355" }}>Наименование</th>
          <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355" }}>Кол-во</th>
          <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355" }}>Цена продажи</th>
          <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355" }}>Поставщик</th>
          <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355" }}>Цена закупки</th>
          <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355" }}>Альт. поставщик</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const matches = (item.barcode ? lookup.get(item.barcode) : undefined)
            ?? lookup.get(item.productName)
            ?? [];
          const [first, ...rest] = matches;
          return (
            <tr key={i} style={{ borderBottom: "1px solid #f0ece5" }}>
              <td style={{ padding: "3px 6px" }}>{item.productName}</td>
              <td style={{ padding: "3px 6px", textAlign: "right" }}>{item.quantity}</td>
              <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtRub(item.unitPrice)}</td>
              <td style={{ padding: "3px 6px", color: first ? "#2E7D32" : "#aaa" }}>
                {first ? first.supplierName : (item.supplierId ? (SUPPLIER_NAMES[item.supplierId] ?? item.supplierId) : "не найден")}
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: first?.priceKopecks ? "#2E7D32" : "#aaa" }}>
                {first?.priceKopecks ? fmtRub(first.priceKopecks) : "—"}
              </td>
              <td style={{ padding: "3px 6px", color: rest[0] ? "#1565C0" : "#aaa", fontSize: 11 }}>
                {rest[0] ? rest[0].supplierName : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Сгруппировать позиции выбранных заказов по поставщику
function groupBySupplier(orders: Order[], orderIds: Set<string>): Record<string, OrderItem[]> {
  const result: Record<string, OrderItem[]> = {};
  for (const o of orders) {
    if (!orderIds.has(o.id)) continue;
    for (const item of o.items) {
      const key = item.supplierId ?? "unknown";
      (result[key] ??= []).push(item);
    }
  }
  return result;
}

export function PurchasingView({ businessId, clientFilter, regionFilter }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading: ordersLoading } = useOrders(businessId, "purchasing", uid);
  const { purchaseOrders, loading: poLoading } = usePurchaseOrders(businessId);


  const [mainTab, setMainTab] = useState<"orders" | "assembly">("assembly");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [supplierKey, setSupplierKey] = useState("msk");
  const [expectedDate, setExpectedDate] = useState("");
  const [saving, setSaving] = useState(false);
  // regionTab используется только когда regionFilter не задан (директор/закупщик видит всё)
  const [regionTab, setRegionTab] = useState<"msk" | "spb">("msk");
  const effectiveRegion = regionFilter ?? regionTab;

  const newOrders = orders.filter((o) => {
    if (o.status !== "received" && o.status !== "approved") return false;
    if (clientFilter && o.customerName !== clientFilter) return false;
    if (effectiveRegion === "spb" ? o.region !== "spb" : (o.region === "spb")) return false;
    return true;
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function createPO() {
    if (selectedIds.size === 0) return;
    setSaving(true);
    try {
      const grouped = groupBySupplier(orders, selectedIds);
      const items = grouped[supplierKey] ?? Object.values(grouped).flat();
      await addDoc(collection(db, `tenants/${businessId}/purchase_orders`), {
        orderIds: [...selectedIds],
        supplierId: supplierKey,
        supplierName: SUPPLIER_NAMES[supplierKey] ?? supplierKey,
        status: "sent",
        items,
        expectedDate,
        region: effectiveRegion,
        createdAt: new Date().toISOString(),
      });
      setSelectedIds(new Set()); setExpectedDate("");
    } catch (e) {
      console.error("createPO:", e);
      alert("Ошибка сохранения: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  if (ordersLoading || poLoading) return <div className="go-main"><div className="go-empty">Загрузка…</div></div>;

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Закупки · Густорико</h1>
      </div>

      {/* Переключатель региона — только когда видны оба */}
      {!regionFilter && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button onClick={() => setRegionTab("msk")}
            style={{ padding: "5px 16px", borderRadius: 20, border: "1px solid #e0d8cc", fontSize: 12, cursor: "pointer",
              background: regionTab === "msk" ? "#C8963480" : "#faf8f4", fontWeight: regionTab === "msk" ? 700 : 400 }}>
            🏙 Москва
          </button>
          <button onClick={() => setRegionTab("spb")}
            style={{ padding: "5px 16px", borderRadius: 20, border: "1px solid #e0d8cc", fontSize: 12, cursor: "pointer",
              background: regionTab === "spb" ? "#1565C080" : "#faf8f4", color: regionTab === "spb" ? "#fff" : undefined, fontWeight: regionTab === "spb" ? 700 : 400 }}>
            🌊 Санкт-Петербург
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="go-tabs" style={{ marginBottom: 16 }}>
        <button className={"go-tab" + (mainTab === "assembly" ? " active" : "")} onClick={() => setMainTab("assembly")}>
          Поставщики
        </button>
        <button className={"go-tab" + (mainTab === "orders" ? " active" : "")} onClick={() => setMainTab("orders")}>
          Наряды
        </button>
      </div>

      {mainTab === "assembly" && <PurchaseLinesSection businessId={businessId} />}

      {mainTab === "orders" && <>
      {/* Заказы для закупки */}
      <div className="go-section-head">
        <h2>Заказы для закупки{clientFilter ? ` · ${clientFilter}` : ""}</h2>
        <span className="go-badge" style={{ background: statusColor("received") + "22", color: statusColor("received") }}>
          {newOrders.length} шт.
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end", background: "rgba(200,154,52,.08)", padding: 12, borderRadius: 8 }}>
          <div className="go-field" style={{ marginBottom: 0, minWidth: 200 }}>
            <label>Поставщик для наряда</label>
            <select value={supplierKey} onChange={(e) => setSupplierKey(e.target.value)}>
              {Object.entries(SUPPLIER_NAMES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="go-field" style={{ marginBottom: 0 }}>
            <label>Ожидаемая дата</label>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
          <button className="go-btn go-btn--gold" onClick={() => void createPO()} disabled={saving}>
            {saving ? "…" : `Создать наряд (${selectedIds.size} заказов)`}
          </button>
        </div>
      )}

      {newOrders.length === 0 ? (
        <div className="go-empty" style={{ marginBottom: 28 }}>Новых заказов нет</div>
      ) : (
        <div className="go-table-wrap" style={{ marginBottom: 28 }}>
          <table className="go-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Позиций</th>
                <th>Сумма</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {newOrders.map((o) => (
                <>
                  <tr
                    key={o.id}
                    style={{ cursor: "pointer", background: expandedId === o.id ? "rgba(21,101,192,.06)" : undefined }}
                    onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                      />
                    </td>
                    <td>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>
                    <td style={{ fontWeight: 500 }}>{o.customerName}</td>
                    <td style={{ textAlign: "center" }}>{o.items.length || "—"}</td>
                    <td>{fmtRub(o.totalKopecks)}</td>
                    <td>
                      <span className="go-badge" style={{ background: statusColor(o.status) + "22", color: statusColor(o.status) }}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                  </tr>
                  {expandedId === o.id && (
                    <tr key={o.id + "-detail"}>
                      <td colSpan={6} style={{ padding: "8px 16px", background: "rgba(21,101,192,.03)" }}>
                        <ItemsTable items={o.items} businessId={businessId} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Наряды поставщикам */}
      <div className="go-section-head">
        <h2>Наряды поставщикам</h2>
      </div>

      {purchaseOrders.length === 0 ? (
        <div className="go-empty">Нарядов пока нет</div>
      ) : (
        <div className="go-table-wrap">
          <table className="go-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поставщик</th>
                <th>Заказов</th>
                <th>Позиций</th>
                <th>Ожидается</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id}>
                  <td>{new Date(po.createdAt).toLocaleDateString("ru-RU")}</td>
                  <td>{po.supplierName ?? po.supplierId}</td>
                  <td style={{ textAlign: "center" }}>{po.orderIds?.length ?? 1}</td>
                  <td style={{ textAlign: "center" }}>{po.items.length}</td>
                  <td>{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString("ru-RU") : "—"}</td>
                  <td>
                    <span className="go-badge" style={{ background: "rgba(200,154,52,.15)", color: "#8B6914" }}>
                      {PO_STATUS_LABEL[po.status] ?? po.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </div>
  );
}
