import { updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, statusLabel, statusColor, fmtRub } from "../useOrders";
import "../orders.css";

interface Props {
  businessId: string;
}

export function AssemblyView({ businessId }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading } = useOrders(businessId, "assembly", uid);

  const approved = orders.filter((o) => o.status === "approved");
  const inAssembly = orders.filter((o) => o.status === "assembly");

  async function startAssembly(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), { status: "assembly" });
  }

  async function markDelivered(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), { status: "delivered" });
  }

  if (loading) return <div className="go-main"><div className="go-empty">Загрузка…</div></div>;

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Формирование заказа · Густорико</h1>
      </div>

      {/* In-progress section */}
      {inAssembly.length > 0 && (
        <>
          <div className="go-section-head">
            <h2>В сборке</h2>
            <span className="go-badge" style={{ background: statusColor("assembly") + "22", color: statusColor("assembly") }}>
              {inAssembly.length} шт.
            </span>
          </div>
          <div className="go-cards" style={{ marginBottom: 28 }}>
            {inAssembly.map((o) => (
              <div key={o.id} className="go-card">
                <div className="go-card-title">{o.clientName}</div>
                <div className="go-card-meta">
                  {o.address && <span>{o.address} · </span>}
                  {fmtRub(o.totalKopecks)} · {new Date(o.createdAt).toLocaleDateString("ru-RU")}
                </div>
                {o.items.length > 0 && (
                  <ul style={{ margin: "0 0 4px", paddingLeft: 16, fontSize: 12, color: "#5A4A35" }}>
                    {o.items.slice(0, 4).map((item, i) => (
                      <li key={i}>{item.name} × {item.qty}</li>
                    ))}
                    {o.items.length > 4 && <li style={{ color: "#aaa" }}>…ещё {o.items.length - 4}</li>}
                  </ul>
                )}
                <div className="go-card-actions">
                  <span className="go-badge" style={{ background: statusColor("assembly") + "22", color: statusColor("assembly") }}>
                    {statusLabel("assembly")}
                  </span>
                  <button className="go-btn go-btn--green" onClick={() => void markDelivered(o.id)}>
                    Отгружено ✓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Awaiting assembly */}
      <div className="go-section-head">
        <h2>Ожидают сборки</h2>
        <span className="go-badge" style={{ background: statusColor("approved") + "22", color: statusColor("approved") }}>
          {approved.length} шт.
        </span>
      </div>

      {approved.length === 0 ? (
        <div className="go-empty">Нет заказов для сборки</div>
      ) : (
        <div className="go-cards">
          {approved.map((o) => (
            <div key={o.id} className="go-card">
              <div className="go-card-title">{o.clientName}</div>
              <div className="go-card-meta">
                {o.address && <span>{o.address} · </span>}
                {fmtRub(o.totalKopecks)} · {new Date(o.createdAt).toLocaleDateString("ru-RU")}
              </div>
              {o.items.length > 0 && (
                <ul style={{ margin: "0 0 4px", paddingLeft: 16, fontSize: 12, color: "#5A4A35" }}>
                  {o.items.slice(0, 4).map((item, i) => (
                    <li key={i}>{item.name} × {item.qty}</li>
                  ))}
                  {o.items.length > 4 && <li style={{ color: "#aaa" }}>…ещё {o.items.length - 4}</li>}
                </ul>
              )}
              {o.comment && (
                <p style={{ fontSize: 12, color: "#8B7355", margin: "4px 0 0", fontStyle: "italic" }}>{o.comment}</p>
              )}
              <div className="go-card-actions">
                <button className="go-btn go-btn--gold" onClick={() => void startAssembly(o.id)}>
                  Начать сборку
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
