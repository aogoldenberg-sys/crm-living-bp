import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, orderBy, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub } from "../useOrders";
import { ReconciliationModal } from "./ReconciliationModal";
import { matchesRegion } from "../region";
import "../orders.css";

interface DebtItem {
  productName: string;
  barcode: string | null;
  qtyOrdered: number;
  qtyShipped: number;
  qtyDebt: number;
  unitSellKopecks: number;
}

interface Debt {
  id: string;
  orderId: string;
  customerName: string;
  assignedManager?: string;
  region?: string;
  address?: string | null;
  createdAt: string;
  deliveryDate?: string;
  items: DebtItem[];
}

function deadlineLabel(createdAt: string): { label: string; color: string } {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days >= 7) return { label: `ПРОСРОЧЕН (${days}д)`, color: "#C62828" };
  if (days >= 5) return { label: `${days}д`, color: "#E65100" };
  return { label: `${days}д`, color: "#2E7D32" };
}

export function DebtsView({ businessId, managerFilter, regionFilter }: {
  businessId: string; managerFilter?: string; regionFilter?: string;
}) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reconDebt, setReconDebt] = useState<Debt | null>(null);

  useEffect(() => {
    setLoading(true);
    setTimedOut(false);
    timerRef.current = setTimeout(() => setTimedOut(true), 15000);

    const q = query(
      collection(db, `tenants/${businessId}/debts`),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, snap => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setDebts(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Debt, "id">) })));
      setLoading(false);
    }, () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setLoading(false);
    });
    return () => { unsub(); if (timerRef.current) clearTimeout(timerRef.current); };
  }, [businessId]);

  const displayed = debts
    .filter(d => !managerFilter || d.assignedManager === managerFilter)
    .filter(d => matchesRegion(d, regionFilter));

  const totalKopecks = displayed.reduce((sum, debt) =>
    sum + debt.items.reduce((s, it) => s + it.qtyDebt * it.unitSellKopecks, 0), 0);

  async function toAssembly(debt: Debt) {
    try {
      await updateDoc(doc(db, `tenants/${businessId}/orders`, debt.orderId), { status: "sourcing" });
    } catch (e) {
      alert("Ошибка: " + String(e));
    }
  }

  async function markShipped(debt: Debt) {
    if (!confirm(`Отгрузить долг для ${debt.customerName}?`)) return;
    try {
      await deleteDoc(doc(db, `tenants/${businessId}/debts`, debt.id));
    } catch (e) {
      alert("Ошибка: " + String(e));
    }
  }

  if (loading && !timedOut) return <div className="go-main"><div className="go-empty">Загрузка…</div></div>;
  if (timedOut && loading) return <div className="go-main"><div className="go-empty">Ошибка загрузки — обновите страницу</div></div>;

  return (
    <>
    <div className="go-main">
      <div className="go-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="go-title">Долги · Густорико</h1>
        {displayed.length > 0 && (
          <div style={{ background: "rgba(198,40,40,.08)", border: "1px solid rgba(198,40,40,.2)",
            borderRadius: 8, padding: "6px 16px", fontSize: 13 }}>
            Итого долг: <strong style={{ color: "#C62828" }}>{fmtRub(totalKopecks)}</strong>
            <span style={{ color: "#8B7355", marginLeft: 8, fontSize: 11 }}>({displayed.length} позиций)</span>
          </div>
        )}
      </div>
      {displayed.length === 0
        ? <div className="go-empty">Долгов нет</div>
        : displayed.map(debt => {
          const dl = deadlineLabel(debt.createdAt);
          const debtTotal = debt.items.reduce((s, it) => s + it.qtyDebt * it.unitSellKopecks, 0);
          return (
            <div key={debt.id} style={{ border: "1px solid rgba(200,154,52,.25)", borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
              <div style={{ background: "rgba(198,40,40,.06)", padding: "10px 16px", borderBottom: "1px solid #f0ece5",
                display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{debt.customerName}</div>
                  <div style={{ fontSize: 11, color: "#8B7355" }}>
                    {new Date(debt.createdAt).toLocaleDateString("ru-RU")}
                    {debt.deliveryDate && ` · доставка ${new Date(debt.deliveryDate).toLocaleDateString("ru-RU")}`}
                    <span style={{ marginLeft: 8, fontWeight: 700, color: dl.color }}>⏱ {dl.label}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "#C62828", fontWeight: 600 }}>
                    {debt.items.reduce((s, i) => s + i.qtyDebt, 0)} позиций · {fmtRub(debtTotal)}
                  </span>
                  <button onClick={() => setReconDebt(debt)}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #8B6914",
                      background: "transparent", color: "#8B6914", cursor: "pointer", fontWeight: 600 }}>
                    Акт сверки
                  </button>
                  <button onClick={() => void toAssembly(debt)}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #C89A34",
                      background: "#C89A34", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                    В сборку
                  </button>
                  <button onClick={() => void markShipped(debt)}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #2E7D32",
                      background: "#2E7D32", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                    Отгрузить
                  </button>
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
                    <th style={{ textAlign: "left", padding: "5px 12px", color: "#8B7355", fontWeight: 600, fontSize: 11 }}>Наименование</th>
                    <th style={{ textAlign: "right", padding: "5px 8px", color: "#8B7355", fontWeight: 600, fontSize: 11 }}>Заказано</th>
                    <th style={{ textAlign: "right", padding: "5px 8px", color: "#8B7355", fontWeight: 600, fontSize: 11 }}>Отгружено</th>
                    <th style={{ textAlign: "right", padding: "5px 8px", color: "#C62828", fontWeight: 600, fontSize: 11 }}>Долг</th>
                    <th style={{ textAlign: "right", padding: "5px 8px", color: "#8B7355", fontWeight: 600, fontSize: 11 }}>Сумма долга</th>
                  </tr>
                </thead>
                <tbody>
                  {debt.items.map((it, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f5f0e8" }}>
                      <td style={{ padding: "4px 12px" }}>{it.productName}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{it.qtyOrdered}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#2E7D32" }}>{it.qtyShipped}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700, color: "#C62828" }}>{it.qtyDebt}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmtRub(it.qtyDebt * it.unitSellKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      }
    </div>

    {reconDebt && (
      <ReconciliationModal
        businessId={businessId}
        customerName={reconDebt.customerName}
        orderId={reconDebt.orderId}
        onClose={() => setReconDebt(null)}
      />
    )}
    </>
  );
}
