import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { BusinessPlanV1 } from "@crm/schemas";

interface Props {
  businessId: string;
}

export function ScenarioHistory({ businessId }: Props) {
  const [plans, setPlans] = useState<BusinessPlanV1[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(db, `tenants/${businessId}/business_plans`);
    // Показываем все планы (история версий — те что архивированы)
    getDocs(query(col, where("status", "==", "archived")))
      .then(snap => {
        const items = snap.docs.map(d => d.data() as BusinessPlanV1);
        setPlans(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  if (loading) {
    return <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Загружаем историю…</p>;
  }

  if (plans.length === 0) {
    return <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Нет архивных версий плана</p>;
  }

  return (
    <div>
      <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#1A1814" }}>
        История версий плана
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plans.map(plan => (
          <div key={plan.planId} style={{
            padding: "10px 14px", borderRadius: 8,
            border: "1px solid rgba(200,154,52,.2)",
            background: "rgba(200,154,52,.04)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#3A2800" }}>
                Версия {plan.version}
              </span>
              <span style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 10,
                background: plan.status === "archived" ? "#F8D7DA" : "#D4EDDA",
                color: plan.status === "archived" ? "#721C24" : "#155724",
                fontWeight: 600,
              }}>
                {plan.status === "archived" ? "Архив" : "Активный"}
              </span>
              <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>
                {new Date(plan.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: "#999", wordBreak: "break-all" }}>
              ID: {plan.planId.slice(0, 8)}…
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
