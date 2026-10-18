import { useState, useEffect, useMemo } from "react";
import { doc, updateDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { useOrders, statusLabel, statusColor, fmtRub, deadlineTimer, type Order, type OrderStatus } from "../useOrders";
import "../orders.css";

interface Props { businessId: string; onGoToPurchasing?: (clientName: string) => void }

const STATUS_ACTIONS: { label: string; status: OrderStatus; color: string }[] = [
  { label: "Одобрен",  status: "approved",  color: "#E65100" },
  { label: "Оплачен",  status: "invoiced",  color: "#AD1457" },
  { label: "Сборка",   status: "sourcing",  color: "#6A1B9A" },
  { label: "В пути",   status: "ordered",   color: "#00695C" },
  { label: "Отменён",  status: "cancelled", color: "#757575" },
];

type Filter = "msk" | "spb" | "in-work" | "overdue" | "today" | null;

function ClientCard({ order, orders, onClose }: { order: Order; orders: Order[]; onClose: () => void }) {
  const clientOrders = orders.filter((o) => o.customerName === order.customerName);
  const totalSpent = clientOrders.reduce((s, o) => s + o.totalKopecks, 0);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FEFCF6", borderRadius: 16, padding: 28, maxWidth: 480, width: "100%",
          boxShadow: "0 8px 40px rgba(0,0,0,.2)", maxHeight: "80vh", overflowY: "auto" }}
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
          {([
            ["Телефон", order.phone || "—"],
            ["Адрес", order.address || "—"],
            ["Всего заказов", String(clientOrders.length)],
            ["Сумма закупок", fmtRub(totalSpent)],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ background: "rgba(200,154,52,.06)", borderRadius: 8, padding: "10px 12px" }}>
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
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 10px", background: "#fff", borderRadius: 8, border: "1px solid rgba(200,154,52,.15)" }}>
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

// Одна плашка со своей подписью, суммой и кликом
function StatCard({ label, value, sub, color, active, onClick }:
  { label: string; value: string; sub?: string; color?: string; active?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: "1 1 140px", minWidth: 140, padding: "14px 16px", borderRadius: 12, cursor: "pointer",
        border: active ? `2px solid ${color ?? "#C8963480"}` : "1px solid rgba(200,154,52,.2)",
        background: active ? `${color ?? "#C89634"}18` : "rgba(200,154,52,.04)",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div style={{ fontSize: 10, color: "#8B7355", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color ?? "#3d2e1a", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#8B7355", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function DirectorView({ businessId }: Props) {
  const { orders, loading } = useOrders(businessId, "director", "");
  const [costByOrder, setCostByOrder] = useState<Map<string, number>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clientOrder, setClientOrder] = useState<Order | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<Filter>(null);
  const [, setTick] = useState(0);

  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60_000); return () => clearInterval(t); }, []);

  // Загружаем purchase_lines для расчёта себестоимости
  useEffect(() => {
    return onSnapshot(collection(db, `tenants/${businessId}/purchase_lines`), snap => {
      const m = new Map<string, number>();
      for (const d of snap.docs) {
        const pl = d.data() as { orderId: string; unitCostKopecks: number; qty: number };
        const prev = m.get(pl.orderId) ?? 0;
        m.set(pl.orderId, prev + (pl.unitCostKopecks ?? 0) * (pl.qty ?? 0));
      }
      setCostByOrder(m);
    });
  }, [businessId]);

  async function changeStatus(order: Order, status: OrderStatus) {
    setUpdatingId(order.id);
    await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { status });
    setUpdatingId(null);
  }

  const now = new Date();
  const today = now.toDateString();

  const delivered    = orders.filter(o => o.status === "delivered");
  const delivMsk     = delivered.filter(o => !o.region || o.region === "msk");
  const delivSpb     = delivered.filter(o => o.region === "spb");

  const revMsk       = delivMsk.reduce((s, o) => s + o.totalKopecks, 0);
  const revSpb       = delivSpb.reduce((s, o) => s + o.totalKopecks, 0);
  const costMsk      = delivMsk.reduce((s, o) => s + (costByOrder.get(o.id) ?? 0), 0);
  const costSpb      = delivSpb.reduce((s, o) => s + (costByOrder.get(o.id) ?? 0), 0);
  const profitMsk    = revMsk - costMsk;
  const profitSpb    = revSpb - costSpb;

  const inWorkCount  = orders.filter(o => ["approved", "sourcing", "ordered"].includes(o.status)).length;
  const overdueCount = orders.filter(o => {
    if (o.status === "delivered" || o.status === "cancelled") return false;
    return Date.now() - new Date(o.createdAt).getTime() > 3 * 24 * 60 * 60 * 1000;
  }).length;
  const todayCount   = orders.filter(o => new Date(o.createdAt).toDateString() === today).length;

  const filteredOrders = useMemo(() => {
    if (!activeFilter) return orders;
    if (activeFilter === "msk")      return orders.filter(o => !o.region || o.region === "msk");
    if (activeFilter === "spb")      return orders.filter(o => o.region === "spb");
    if (activeFilter === "in-work")  return orders.filter(o => ["approved", "sourcing", "ordered"].includes(o.status));
    if (activeFilter === "overdue")  return orders.filter(o => {
      if (o.status === "delivered" || o.status === "cancelled") return false;
      return Date.now() - new Date(o.createdAt).getTime() > 3 * 24 * 60 * 60 * 1000;
    });
    if (activeFilter === "today")    return orders.filter(o => new Date(o.createdAt).toDateString() === today);
    return orders;
  }, [orders, activeFilter, today]);

  function toggleFilter(f: Filter) { setActiveFilter(prev => prev === f ? null : f); }

  if (loading) return <div className="go-empty">Загрузка…</div>;

  const pct = (profit: number, rev: number) =>
    rev > 0 ? `${Math.round(profit / rev * 100)} %` : "";

  return (
    <div>
      {clientOrder && <ClientCard order={clientOrder} orders={orders} onClose={() => setClientOrder(null)} />}

      <div className="go-header">
        <h2 className="go-title">Заказы · Густорико</h2>
        <p className="go-subtitle">Сводная панель руководителя</p>
      </div>

      {/* Финансовые плашки — МСК и СПб */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <StatCard
          label="Выручка МСК"
          value={fmtRub(revMsk)}
          sub={`${delivMsk.length} отгрузок`}
          color="#C89634"
          active={activeFilter === "msk"}
          onClick={() => toggleFilter("msk")}
        />
        <StatCard
          label="Прибыль МСК"
          value={fmtRub(profitMsk)}
          sub={pct(profitMsk, revMsk)}
          color={profitMsk >= 0 ? "#2E7D32" : "#C62828"}
          active={activeFilter === "msk"}
          onClick={() => toggleFilter("msk")}
        />
        <StatCard
          label="Выручка СПб"
          value={fmtRub(revSpb)}
          sub={`${delivSpb.length} отгрузок`}
          color="#1565C0"
          active={activeFilter === "spb"}
          onClick={() => toggleFilter("spb")}
        />
        <StatCard
          label="Прибыль СПб"
          value={fmtRub(profitSpb)}
          sub={pct(profitSpb, revSpb)}
          color={profitSpb >= 0 ? "#2E7D32" : "#C62828"}
          active={activeFilter === "spb"}
          onClick={() => toggleFilter("spb")}
        />
      </div>

      {/* Оперативные плашки */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard
          label="Сегодня"
          value={String(todayCount)}
          color="#C89634"
          active={activeFilter === "today"}
          onClick={() => toggleFilter("today")}
        />
        <StatCard
          label="В работе"
          value={String(inWorkCount)}
          color="#E65100"
          active={activeFilter === "in-work"}
          onClick={() => toggleFilter("in-work")}
        />
        <StatCard
          label="Просрочено"
          value={String(overdueCount)}
          color={overdueCount > 0 ? "#C62828" : "#2E7D32"}
          active={activeFilter === "overdue"}
          onClick={() => toggleFilter("overdue")}
        />
      </div>

      <div className="go-section-head">
        <h2>
          Все заказы
          {activeFilter && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "#8B7355" }}>
              · фильтр активен
              <button onClick={() => setActiveFilter(null)}
                style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer",
                  color: "#C62828", fontSize: 11, padding: 0 }}>
                сбросить
              </button>
            </span>
          )}
        </h2>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="go-empty">Заказов нет</div>
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
              {filteredOrders.map((o) => (
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
                            if (o.status === "sourcing"  && a.status === "approved") return false;
                            if (o.status === "ordered"   && (a.status === "approved" || a.status === "sourcing")) return false;
                            if (o.status === "delivered" && (a.status === "approved" || a.status === "sourcing" || a.status === "ordered")) return false;
                            return true;
                          }).map((a) => (
                            <button key={a.status}
                              onClick={() => void changeStatus(o, a.status)}
                              style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                                border: `1px solid ${a.color}33`, borderRadius: 6, background: "transparent",
                                color: a.color, whiteSpace: "nowrap" }}>
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
