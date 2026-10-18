import { useOrders, statusLabel, statusColor, fmtRub, type OrderStatus } from "../useOrders";
import "../orders.css";

interface Props {
  businessId: string;
}

const STAGES: { status: OrderStatus; label: string }[] = [
  { status: "received", label: "Получен" },
  { status: "approved", label: "Одобрен" },
  { status: "assembly", label: "Сборка" },
  { status: "delivered", label: "Отгружен" },
];

function thisMonthKopecks(orders: ReturnType<typeof useOrders>["orders"]): number {
  const now = new Date();
  return orders
    .filter((o) => {
      const d = new Date(o.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, o) => s + o.totalKopecks, 0);
}

function todayCount(orders: ReturnType<typeof useOrders>["orders"]): number {
  const today = new Date().toDateString();
  return orders.filter((o) => new Date(o.createdAt).toDateString() === today).length;
}

export function DirectorView({ businessId }: Props) {
  // director sees all orders — pass dummy userId, role=director
  const { orders, loading } = useOrders(businessId, "director", "");

  if (loading) return <div className="go-empty">Загрузка…</div>;

  const inWork = orders.filter((o) => o.status === "assembly" || o.status === "approved").length;
  const overdue = orders.filter((o) => {
    if (o.status === "delivered" || o.status === "cancelled") return false;
    const age = Date.now() - new Date(o.createdAt).getTime();
    return age > 3 * 24 * 60 * 60 * 1000; // older than 3 days
  }).length;

  return (
    <div>
      <div className="go-header">
        <h2 className="go-title">Заказы · Густорико</h2>
        <p className="go-subtitle">Сводная панель руководителя</p>
      </div>

      {/* KPI */}
      <div className="go-stats">
        <div className="go-stat-card">
          <div className="label">Заказов сегодня</div>
          <div className="value">{todayCount(orders)}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Выручка месяца</div>
          <div className="value" style={{ fontSize: 18 }}>{fmtRub(thisMonthKopecks(orders))}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">В работе</div>
          <div className="value" style={{ color: "#E65100" }}>{inWork}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Просрочено</div>
          <div className="value" style={{ color: overdue > 0 ? "#C62828" : "#2E7D32" }}>{overdue}</div>
        </div>
      </div>

      {/* Kanban */}
      <div className="go-kanban">
        {STAGES.map(({ status, label }) => {
          const col = orders.filter((o) => o.status === status);
          const total = col.reduce((s, o) => s + o.totalKopecks, 0);
          return (
            <div key={status} className="go-kanban-col">
              <div className="go-kanban-col-head" style={{ color: statusColor(status) }}>
                {label}
              </div>
              <div className="go-kanban-count">{col.length}</div>
              <div className="go-kanban-sub">{fmtRub(total)}</div>
            </div>
          );
        })}
      </div>

      {/* Recent orders */}
      <div className="go-section-head">
        <h2>Последние заказы</h2>
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
                <th>Сумма</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 10).map((o) => (
                <tr key={o.id}>
                  <td>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>
                  <td>{o.clientName}</td>
                  <td style={{ fontSize: 11, color: "#8B7355" }}>{o.managerId || "—"}</td>
                  <td>{fmtRub(o.totalKopecks)}</td>
                  <td>
                    <span
                      className="go-badge"
                      style={{
                        background: statusColor(o.status) + "22",
                        color: statusColor(o.status),
                      }}
                    >
                      {statusLabel(o.status)}
                    </span>
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
