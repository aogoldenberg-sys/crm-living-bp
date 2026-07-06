import { useState } from "react";
import { KndUploader } from "../documents/KndUploader.js";
import "./TaxReportingScreen.css";

type ActionId = "usn" | "zero" | "kudir" | "xml";

const ACTIONS = [
  { id: "usn"  as const, label: "Сформировать УСН",  desc: "Декларация УСН 6% или 15% за год", icon: "📄" },
  { id: "zero" as const, label: "Нулёвая отчётность", desc: "Нет операций — подготовить нулёвку", icon: "○" },
  { id: "kudir"as const, label: "КУДиР",              desc: "Книга учёта доходов и расходов",   icon: "📒" },
];

export function TaxReportingScreen({ businessId: _ }: { businessId: string }) {
  const [active, setActive] = useState<ActionId | null>(null);

  if (active === "xml") {
    return (
      <div className="tax-screen">
        <button className="tax-back-btn" onClick={() => setActive(null)}>← Назад</button>
        <KndUploader />
      </div>
    );
  }

  if (active) {
    const action = ACTIONS.find(a => a.id === active);
    return (
      <div className="tax-screen">
        <button className="tax-back-btn" onClick={() => setActive(null)}>← Назад к отчётности</button>
        <p className="tax-coming-soon">
          Функция «{action?.label}» будет доступна в следующем обновлении.
          Расчётный модуль готов (packages/core/tax/usn.ts).
        </p>
      </div>
    );
  }

  return (
    <div className="tax-screen">
      <h2 className="tax-title">Налоговая отчётность</h2>
      <div className="tax-actions-grid">
        {ACTIONS.map(a => (
          <button key={a.id} className="tax-action-card" onClick={() => setActive(a.id)}>
            <span className="tax-action-icon">{a.icon}</span>
            <span className="tax-action-label">{a.label}</span>
            <span className="tax-action-desc">{a.desc}</span>
          </button>
        ))}
      </div>
      <button className="tax-xml-btn" onClick={() => setActive("xml")}>
        Загрузить XML документ ФНС
      </button>
    </div>
  );
}
