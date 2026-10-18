import { useState, useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useOrders, statusLabel, statusColor, fmtRub, deadlineTimer, type Order, type OrderStatus } from "../useOrders";
import "../orders.css";

interface Props { businessId: string; onGoToPurchasing?: (clientName: string) => void }

const KANBAN_STAGES: OrderStatus[] = ["received", "approved", "sourcing", "ordered", "delivered"];

// Кнопки смены статуса: метка → OrderStatus
const STATUS_ACTIONS: { label: string; status: OrderStatus; color: string }[] = [
  { label: "Одобрен",  status: "approved",  color: "#E65100" },
  { label: "Оплачен",  status: "invoiced",  color: "#AD1457" },
  { label: "Сборка",   status: "sourcing",  color: "#6A1B9A" },
  { label: "В пути",   status: "ordered",   color: "#00695C" },
  { label: "Отменён",  status: "cancelled", color: "#757575" },
];

function ClientCard({ order, orders, onClose }: { order: Order; orders: Order[]; onClose: () => void }) {
  const clientOrders = orders.filter((o) => o.customerName === order.customerName);
  const totalSpent = clientOrders.reduce((s, o) => s + o.totalKopecks, 0);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#FEFCF6", borderRadius: 16, padding: 28, maxWidth: 480, width: "100%",
          boxShadow: "0 8px 40px rgba(0,0,0,.2)", maxHeight: "80vh", overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{order.customerName}</h2>
            {order.customerInn && <div style={{ fontSize: 12, color: "#8B7355", marginTop: 3 }}>ИНН {order.customerInn}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#8B7355", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[
            ["Телефон", order.phone || "—"],
            ["Адрес", order.address || "—"],
            ["Всего заказов", clientOrders.length],
            ["Сумма закупок", fmtRub(totalSpent)],
          ].map(([l, v]) => (
            <div key={l as string} style={{ background: "rgba(200,154,52,.06)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: "#8B7355", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: "#8B7355", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
          История заказов
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {clientOrders.map((o) => (
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#fff", borderRadius: 8, border: "1px solid rgba(200,154,52,.15)" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</div>
                <div style={{ fontSize: 11, color: "#8B7355" }}>{o.items.length} поз.</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtRub(o.totalKopecks)}</div>
                <span className="go-badge" style={{ background: statusColor(o.status) + "22", color: statusColor(o.status), fontSize: 10 }}>
                  {statusLabel(o.status)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DirectorView({ businessId }: Props) {
  const { orders, loading } = useOrders(businessId, "director", "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clientOrder, setClientOrder] = useState<Order | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60_000); return () => clearInterval(t); }, []);

  async function changeStatus(order: Order, status: OrderStatus) {
    setUpdatingId(order.id);
    await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { status });
    // Уведомление клиентам — временно отключено
    // if (order.email) {
    //   void fetch("https://opentgp.ru/food/pay-proxy.php", {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-notify" },
    //     body: JSON.stringify({ email: order.email, customerName: order.customerName, orderId: order.id, status, statusLabel: statusLabel(status) }),
    //   });
    // }
    setUpdatingId(null);
  }

  if (loading) return <div className="go-empty">Загрузка…</div>;

  const now = new Date();
  const monthOrders = orders.filter((o) => {
    const d = new Date(o.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthRevenue = monthOrders.filter((o) => o.paid).reduce((s, o) => s + o.totalKopecks, 0);
  const inWork = orders.filter((o) => o.status === "approved" || o.status === "sourcing" || o.status === "ordered").length;
  const overdue = orders.filter((o) => {
    if (o.status === "delivered" || o.status === "cancelled") return false;
    return Date.now() - new Date(o.createdAt).getTime() > 3 * 24 * 60 * 60 * 1000;
  }).length;
  const todayCount = orders.filter((o) => new Date(o.createdAt).toDateString() === now.toDateString()).length;

  return (
    <div>
      {clientOrder && (
        <ClientCard order={clientOrder} orders={orders} onClose={() => setClientOrder(null)} />
      )}

      <div className="go-header">
        <h2 className="go-title">Заказы · Густорико</h2>
        <p className="go-subtitle">Сводная панель руководителя</p>
      </div>

      <div className="go-stats">
        <div className="go-stat-card go-stat-card--gold">
          <div className="label">Заказов сегодня</div>
          <div className="value">{todayCount}</div>
        </div>
        <div className="go-stat-card go-stat-card--bronze">
          <div className="label">Выручка месяца</div>
          <div className="value" style={{ fontSize: 18 }}>{fmtRub(monthRevenue)}</div>
        </div>
        <div className="go-stat-card go-stat-card--silver">
          <div className="label">В работе</div>
          <div className="value">{inWork}</div>
        </div>
        <div className="go-stat-card" style={{ background: overdue > 0 ? "rgba(198,40,40,.08)" : undefined, borderColor: overdue > 0 ? "rgba(198,40,40,.25)" : undefined }}>
          <div className="label">Просрочено</div>
          <div className="value" style={{ color: overdue > 0 ? "#C62828" : "#2E7D32" }}>{overdue}</div>
        </div>
      </div>

      <div className="go-kanban">
        {KANBAN_STAGES.map((stage) => {
          const col = orders.filter((o) => o.status === stage);
          const total = col.reduce((s, o) => s + o.totalKopecks, 0);
          return (
            <div key={stage} className="go-kanban-col">
              <div className="go-kanban-col-head" style={{ color: statusColor(stage) }}>{statusLabel(stage)}</div>
              <div className="go-kanban-count">{col.length}</div>
              <div className="go-kanban-sub">{fmtRub(total)}</div>
            </div>
          );
        })}
      </div>

      <div className="go-section-head">
        <h2>Все заказы</h2>
      </div>

      {orders.length === 0 ? (
        <div className="go-empty">Заказов пока нет</div>
      ) : (
        <div className="go-table-wrap">
          <table className="go-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Менеджер</th>
                <th>Позиций</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <>
                  <tr
                    key={o.id}
                    style={{ cursor: "pointer", background: expandedId === o.id ? "rgba(21,101,192,.06)" : undefined }}
                    onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                  >
                    <td>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>
                    <td>
                      <span
                        style={{ fontWeight: 500, cursor: "pointer", color: "#1565C0", textDecoration: "underline dotted" }}
                        onClick={(e) => { e.stopPropagation(); setClientOrder(o); }}
                      >
                        {o.customerName}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: "#8B7355" }}>{o.managerId || "—"}</td>
                    <td style={{ textAlign: "center" }}>{o.items.length || "—"}</td>
                    <td>{fmtRub(o.totalKopecks)}</td>
                    <td>
                      <span className="go-badge" style={{ background: statusColor(o.status) + "22", color: statusColor(o.status) }}>
                        {statusLabel(o.status)}
                      </span>
                      {o.status !== "delivered" && o.status !== "cancelled" && (() => {
                        const fromISO = o.paid ? (o.paidAt ?? o.createdAt) : o.createdAt;
                        const t = deadlineTimer(fromISO, 3);
                        const typeIcon = o.paid ? "🚚" : "💳";
                        const typeHint = o.paid ? "до отгрузки" : "до оплаты";
                        return (
                          <div title={typeHint} style={{ fontSize: 9, color: t.color, marginTop: 2 }}>
                            {t.dot} {t.label} {typeIcon}
                          </div>
                        );
                      })()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                      {updatingId === o.id ? (
                        <span style={{ fontSize: 11, color: "#8B7355" }}>…</span>
                      ) : (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {STATUS_ACTIONS.filter((a) => {
                            if (a.status === o.status) return false;
                            // запрет обратных переходов по пайплайну
                            if (o.status === "sourcing"  && a.status === "approved") return false;
                            if (o.status === "ordered"   && (a.status === "approved" || a.status === "sourcing")) return false;
                            if (o.status === "delivered" && (a.status === "approved" || a.status === "sourcing" || a.status === "ordered")) return false;
                            return true;
                          }).map((a) => (
                            <button
                              key={a.status}
                              onClick={() => void changeStatus(o, a.status)}
                              style={{
                                padding: "3px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                                border: `1px solid ${a.color}33`, borderRadius: 6, background: "transparent",
                                color: a.color, whiteSpace: "nowrap",
                              }}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === o.id && (
                    <tr key={o.id + "-detail"}>
                      <td colSpan={7} style={{ padding: "8px 16px", background: "rgba(21,101,192,.03)", fontSize: 12 }}>
                        {o.items.length === 0 ? (
                          <span style={{ color: "#aaa" }}>Позиции не заданы</span>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid #e0d8cc" }}>
                                <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355" }}>Наименование</th>
                                <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355" }}>Кол-во</th>
                                <th style={{ textAlign: "right", padding: "3px 6px", color: "#8B7355" }}>Цена</th>
                                <th style={{ textAlign: "left", padding: "3px 6px", color: "#8B7355" }}>Поставщик</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.items.map((item, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid #f0ece5" }}>
                                  <td style={{ padding: "3px 6px" }}>{item.productName}</td>
                                  <td style={{ padding: "3px 6px", textAlign: "right" }}>{item.quantity}</td>
                                  <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtRub(item.unitPrice)}</td>
                                  <td style={{ padding: "3px 6px", color: item.supplierId ? "#2E7D32" : "#aaa" }}>
                                    {item.supplierId ?? "не назначен"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {o.comment && <p style={{ margin: "6px 0 0", color: "#8B7355", fontStyle: "italic" }}>{o.comment}</p>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
