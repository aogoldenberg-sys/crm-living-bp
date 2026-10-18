import { useState } from "react";
import { updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, statusLabel, statusColor, fmtRub } from "../useOrders";
import "../orders.css";

interface Props {
  businessId: string;
}

type PayFilter = "all" | "paid" | "unpaid";

function isOverdue(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 7 * 24 * 60 * 60 * 1000;
}

function thisMonthKopecks(orders: ReturnType<typeof useOrders>["orders"]): number {
  const now = new Date();
  return orders
    .filter((o) => {
      const d = new Date(o.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, o) => s + o.totalKopecks, 0);
}

export function FinanceView({ businessId }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading } = useOrders(businessId, "finance", uid);
  const [filter, setFilter] = useState<PayFilter>("all");

  const active = orders.filter((o) => o.status !== "cancelled");

  const todayDue = active
    .filter((o) => !o.paid && new Date(o.createdAt).toDateString() === new Date().toDateString())
    .reduce((s, o) => s + o.totalKopecks, 0);

  const totalDebt = active.filter((o) => !o.paid).reduce((s, o) => s + o.totalKopecks, 0);
  const monthRevenue = thisMonthKopecks(active.filter((o) => o.paid ?? false));

  const filtered = active.filter((o) => {
    if (filter === "paid") return o.paid;
    if (filter === "unpaid") return !o.paid;
    return true;
  });

  async function markPaid(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), { paid: true });
  }

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Финансы и оплаты · Густорико</h1>
      </div>

      {/* Stats */}
      <div className="go-stats">
        <div className="go-stat-card">
          <div className="label">К получению сегодня</div>
          <div className="value" style={{ fontSize: 18 }}>{fmtRub(todayDue)}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Долги клиентов</div>
          <div className="value" style={{ fontSize: 18, color: totalDebt > 0 ? "#C62828" : "#2E7D32" }}>
            {fmtRub(totalDebt)}
          </div>
        </div>
        <div className="go-stat-card">
          <div className="label">Выручка месяца</div>
          <div className="value" style={{ fontSize: 18 }}>{fmtRub(monthRevenue)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="go-tabs">
        {(["all", "unpaid", "paid"] as PayFilter[]).map((t) => (
          <button
            key={t}
            className={"go-tab" + (filter === t ? " active" : "")}
            onClick={() => setFilter(t)}
          >
            {t === "all" ? "Все" : t === "unpaid" ? "Не оплачено" : "Оплачено"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="go-empty">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="go-empty">Нет заказов</div>
      ) : (
        <div className="go-table-wrap">
          <table className="go-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Оплата</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const overdue = !o.paid && isOverdue(o.createdAt);
                return (
                  <tr key={o.id}>
                    <td>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>
                    <td style={{ color: overdue ? "#C62828" : undefined, fontWeight: overdue ? 600 : undefined }}>
                      {o.clientName}
                      {overdue && <span style={{ fontSize: 10, marginLeft: 6, color: "#C62828" }}>просрочено</span>}
                    </td>
                    <td>{fmtRub(o.totalKopecks)}</td>
                    <td>
                      <span className="go-badge" style={{ background: statusColor(o.status) + "22", color: statusColor(o.status) }}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td>
                      <span className="go-badge" style={{ background: o.paid ? "#D4EDDA" : "#F8D7DA", color: o.paid ? "#155724" : "#721C24" }}>
                        {o.paid ? "Оплачено" : "Долг"}
                      </span>
                    </td>
                    <td>
                      {!o.paid ? (
                        <button className="go-btn go-btn--green" onClick={() => void markPaid(o.id)}>
                          Отметить оплачено
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "#aaa" }}>✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
