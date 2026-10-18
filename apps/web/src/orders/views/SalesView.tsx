import { useState, useMemo } from "react";
import { collection, addDoc, updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, statusLabel, statusColor, fmtRub, type OrderStatus, type OrderSource } from "../useOrders";
import "../orders.css";

interface Props {
  businessId: string;
}

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  received: "approved",
  approved: "assembly",
  assembly: "delivered",
};

const SOURCE_LABELS: Record<OrderSource, string> = {
  napolke: "НаПолке",
  shop: "Магазин",
  manual: "Вручную",
};

function thisMonth(orders: ReturnType<typeof useOrders>["orders"]) {
  const now = new Date();
  return orders.filter((o) => {
    const d = new Date(o.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
}

export function SalesView({ businessId }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading } = useOrders(businessId, "sales", uid);

  const [showForm, setShowForm] = useState(false);
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [source, setSource] = useState<OrderSource>("manual");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const monthOrders = thisMonth(orders);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      o.clientName.toLowerCase().includes(q) ||
      (o.source && SOURCE_LABELS[o.source]?.toLowerCase().includes(q)) ||
      statusLabel(o.status).toLowerCase().includes(q)
    );
  }, [orders, search]);
  const monthRevenue = monthOrders.reduce((s, o) => s + o.totalKopecks, 0);

  async function createOrder() {
    if (!clientName.trim()) return;
    setSaving(true);
    await addDoc(collection(db, `tenants/${businessId}/orders`), {
      clientName: clientName.trim(),
      phone,
      comment,
      source,
      status: "received" as OrderStatus,
      totalKopecks: 0,
      managerId: uid,
      items: [],
      createdAt: new Date().toISOString(),
    });
    setClientName(""); setPhone(""); setComment(""); setSource("manual");
    setShowForm(false);
    setSaving(false);
  }

  async function advanceStatus(orderId: string, current: OrderStatus) {
    const next = NEXT_STATUS[current];
    if (!next) return;
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), { status: next });
  }

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Мои заказы · Густорико</h1>
      </div>

      {/* Stats */}
      <div className="go-stats">
        <div className="go-stat-card">
          <div className="label">Заказов в этом месяце</div>
          <div className="value">{monthOrders.length}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Выручка месяца</div>
          <div className="value" style={{ fontSize: 18 }}>{fmtRub(monthRevenue)}</div>
        </div>
      </div>

      {/* New order form */}
      <div className="go-section-head">
        <h2>Заказы</h2>
        <button className="go-btn go-btn--gold" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Отмена" : "+ Новый заказ"}
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          className="go-search-input"
          placeholder="Поиск по клиенту, статусу, источнику..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {showForm && (
        <div className="go-form">
          <h3>Новый заказ</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="go-field">
              <label>Клиент</label>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Имя / компания" />
            </div>
            <div className="go-field">
              <label>Телефон</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7..." />
            </div>
            <div className="go-field">
              <label>Источник</label>
              <select value={source} onChange={(e) => setSource(e.target.value as OrderSource)}>
                {(Object.keys(SOURCE_LABELS) as OrderSource[]).map((s) => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="go-field">
              <label>Комментарий</label>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Примечание" />
            </div>
          </div>
          <button className="go-btn go-btn--gold" onClick={() => void createOrder()} disabled={saving || !clientName.trim()}>
            {saving ? "Сохраняем…" : "Создать заказ"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="go-empty">Загрузка…</div>
      ) : orders.length === 0 ? (
        <div className="go-empty">Заказов нет — создайте первый</div>
      ) : (
        <div className="go-table-wrap">
          <table className="go-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Источник</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#aaa", padding: 20 }}>Ничего не найдено</td></tr>
              )}
              {visibleOrders.map((o) => (
                <tr key={o.id}>
                  <td>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>
                  <td>{o.clientName}</td>
                  <td>{SOURCE_LABELS[o.source] ?? o.source}</td>
                  <td>{fmtRub(o.totalKopecks)}</td>
                  <td>
                    <span className="go-badge" style={{ background: statusColor(o.status) + "22", color: statusColor(o.status) }}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td>
                    {NEXT_STATUS[o.status] ? (
                      <button className="go-btn go-btn--outline" onClick={() => void advanceStatus(o.id, o.status)}>
                        → {statusLabel(NEXT_STATUS[o.status]!)}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: "#aaa" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
