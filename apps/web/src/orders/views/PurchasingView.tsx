import { useState } from "react";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, usePurchaseOrders, statusLabel, statusColor, fmtRub } from "../useOrders";
import "../orders.css";

interface Props {
  businessId: string;
}

const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  sent: "Отправлен",
  confirmed: "Подтверждён",
  delivered: "Получен",
};

export function PurchasingView({ businessId }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading: ordersLoading } = useOrders(businessId, "purchasing", uid);
  const { purchaseOrders, loading: poLoading } = usePurchaseOrders(businessId);

  const newOrders = orders.filter((o) => o.status === "received");

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function createPO(orderId: string) {
    if (!supplierName.trim()) return;
    setSaving(true);
    const order = orders.find((o) => o.id === orderId);
    await addDoc(collection(db, `tenants/${businessId}/purchase_orders`), {
      orderId,
      supplierId: supplierName.trim(),
      supplierName: supplierName.trim(),
      status: "sent",
      items: order?.items ?? [],
      expectedDate,
      createdAt: new Date().toISOString(),
    });
    setSupplierName(""); setExpectedDate(""); setActiveOrderId(null);
    setSaving(false);
  }

  if (ordersLoading || poLoading) return <div className="go-main"><div className="go-empty">Загрузка…</div></div>;

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Закупки · Густорико</h1>
      </div>

      {/* New orders needing purchase */}
      <div className="go-section-head">
        <h2>Новые заказы</h2>
        <span className="go-badge" style={{ background: statusColor("received") + "22", color: statusColor("received") }}>
          {newOrders.length} шт.
        </span>
      </div>

      {newOrders.length === 0 ? (
        <div className="go-empty" style={{ marginBottom: 28 }}>Новых заказов нет</div>
      ) : (
        <div className="go-table-wrap" style={{ marginBottom: 28 }}>
          <table className="go-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Позиций</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {newOrders.map((o) => (
                <>
                  <tr key={o.id}>
                    <td>{new Date(o.createdAt).toLocaleDateString("ru-RU")}</td>
                    <td>{o.clientName}</td>
                    <td>{o.items.length}</td>
                    <td>{fmtRub(o.totalKopecks)}</td>
                    <td>
                      <span className="go-badge" style={{ background: statusColor(o.status) + "22", color: statusColor(o.status) }}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td>
                      <button
                        className="go-btn go-btn--outline"
                        onClick={() => setActiveOrderId(activeOrderId === o.id ? null : o.id)}
                      >
                        {activeOrderId === o.id ? "Отмена" : "Создать наряд"}
                      </button>
                    </td>
                  </tr>
                  {activeOrderId === o.id && (
                    <tr key={o.id + "-form"}>
                      <td colSpan={6} style={{ padding: "12px 14px", background: "rgba(200,154,52,.04)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
                          <div className="go-field" style={{ marginBottom: 0 }}>
                            <label>Поставщик</label>
                            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Название поставщика" />
                          </div>
                          <div className="go-field" style={{ marginBottom: 0 }}>
                            <label>Ожидаемая дата</label>
                            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                          </div>
                          <button className="go-btn go-btn--gold" onClick={() => void createPO(o.id)} disabled={saving || !supplierName.trim()}>
                            {saving ? "…" : "Отправить"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchase orders list */}
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
                  <td>{po.items.length}</td>
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
    </div>
  );
}
