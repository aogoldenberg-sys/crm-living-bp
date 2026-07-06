import { useState } from "react";
import { KndUploader } from "../documents/KndUploader.js";
import { UsnCalcView } from "./UsnCalcView.js";
import { useBusinessEvents } from "./useBusinessEvents.js";
import "./TaxReportingScreen.css";

type ActionId = "usn" | "zero" | "kudir" | "xml";

const ACTIONS = [
  { id: "usn"   as const, label: "Сформировать УСН",   desc: "Декларация УСН 6% или 15% за год",  icon: "📄" },
  { id: "zero"  as const, label: "Нулёвая отчётность", desc: "Нет операций — подготовить нулёвку", icon: "○" },
  { id: "kudir" as const, label: "КУДиР",              desc: "Книга учёта доходов и расходов",     icon: "📒" },
];

export function TaxReportingScreen({ businessId }: { businessId: string }) {
  const [active, setActive] = useState<ActionId | null>(null);
  const { data: events = [] } = useBusinessEvents(businessId);

  if (active === "xml") {
    return (
      <div className="tax-screen">
        <button className="tax-back-btn" onClick={() => setActive(null)}>← Назад</button>
        <KndUploader />
      </div>
    );
  }

  if (active === "usn") {
    return (
      <div className="tax-screen">
        <button className="tax-back-btn" onClick={() => setActive(null)}>← Назад к отчётности</button>
        <h2 className="tax-title">Декларация УСН</h2>
        <UsnCalcView mode="usn" events={events} businessId={businessId} />
      </div>
    );
  }

  if (active === "kudir") {
    return (
      <div className="tax-screen">
        <button className="tax-back-btn" onClick={() => setActive(null)}>← Назад к отчётности</button>
        <h2 className="tax-title">КУДиР</h2>
        <UsnCalcView mode="kudir" events={events} businessId={businessId} />
      </div>
    );
  }

  if (active === "zero") {
    return (
      <div className="tax-screen">
        <button className="tax-back-btn" onClick={() => setActive(null)}>← Назад к отчётности</button>
        <h2 className="tax-title">Нулёвая отчётность</h2>
        <div className="tax-zero-info">
          <p>Нулёвая декларация подаётся при отсутствии доходов и расходов за период.</p>
          <p>Нажмите «Скачать XML», чтобы получить шаблон нулёвой декларации УСН.</p>
          <button
            type="button"
            className="tax-download-btn"
            style={{ marginTop: 16 }}
            onClick={() => {
              const xml = `<?xml version="1.0" encoding="UTF-8"?>
<УСН><Декларация><ИНН/><Период>${new Date().getFullYear()}</Период><Статус>нулёвая</Статус></Декларация></УСН>`;
              const blob = new Blob([xml], { type: "application/xml" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `УСН_нулёвая_${new Date().getFullYear()}.xml`; a.click();
              URL.revokeObjectURL(url);
            }}
          >
            📥 Скачать XML нулёвки
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tax-screen">
      <h2 className="tax-title">Налоговая отчётность</h2>
      {events.length > 0 && (
        <p className="tax-events-count">
          📊 {events.length} событий в базе
        </p>
      )}
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
