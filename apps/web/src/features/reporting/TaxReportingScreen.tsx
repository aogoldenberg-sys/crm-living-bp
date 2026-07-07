import { useState } from "react";
import { KndUploader } from "../documents/KndUploader.js";
import { UsnCalcView } from "./UsnCalcView.js";
import { useBusinessEvents } from "./useBusinessEvents.js";
import "./TaxReportingScreen.css";

const CURRENT_YEAR = new Date().getFullYear();

function generateZeroXml(inn: string, oktmo: string, year: number, regime: "usn6" | "usn15"): string {
  const regimeCode = regime === "usn6" ? "1" : "2";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- КНД 1152017: Декларация по налогу при УСН (нулёвая) -->
<!-- Сформировано: ${new Date().toLocaleDateString("ru-RU")} | Kairos CRM -->
<Файл КНД="0000000" ВерсФорм="5.02">
  <Документ ПериодОтч="34" ОтчетГод="${year}" НомКорр="0" ОКТМО="${oktmo || "00000000"}">
    <СвНП>
      <НПИП ИННФЛ="${inn || "000000000000"}" />
    </СвНП>
    <СвУСН ОбъектНал="${regimeCode}" НалСтавка="${regime === "usn6" ? "6" : "15"}">
      <ДохРасх ДохОтч1="0" ДохОтч2="0" ДохОтч3="0" ДохОтч4="0" />
      ${regime === "usn15" ? '<РасхОтч РасхОтч1="0" РасхОтч2="0" РасхОтч3="0" РасхОтч4="0" />' : ""}
      <НалИсч НалИсч1="0" НалИсч2="0" НалИсч3="0" НалИсч4="0" />
      <НалПУ НалПУ1="0" НалПУ2="0" НалПУ3="0" СумНалДокл="0" СумНалУм="0" />
    </СвУСН>
  </Документ>
</Файл>`;
}

function ZeroView({ onBack }: { onBack: () => void }) {
  const [inn, setInn] = useState("");
  const [oktmo, setOktmo] = useState("");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [regime, setRegime] = useState<"usn6" | "usn15">("usn6");

  function handleDownload() {
    const xml = generateZeroXml(inn, oktmo, year, regime);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `УСН_нулёвая_${inn || "ИНН"}_${year}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    const xml = generateZeroXml(inn, oktmo, year, regime);
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Нулёвая УСН ${year}</title>
      <style>body{font-family:monospace;font-size:12px;padding:40px}pre{white-space:pre-wrap}</style></head>
      <body><h2>Нулёвая декларация УСН ${year}</h2><pre>${xml.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre></body></html>`);
    w.document.close();
    w.print();
  }

  return (
    <div className="tax-screen">
      <button className="tax-back-btn" onClick={onBack}>← Назад к отчётности</button>
      <h2 className="tax-title">Нулёвая отчётность (КНД 1152017)</h2>
      <div className="tax-calc-form">
        <div className="tax-field">
          <label className="tax-label">Год</label>
          <select className="tax-input" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="tax-field">
          <label className="tax-label">ИНН</label>
          <input className="tax-input" type="text" maxLength={12} placeholder="123456789012"
            value={inn} onChange={e => setInn(e.target.value)} />
        </div>
        <div className="tax-field">
          <label className="tax-label">ОКТМО</label>
          <input className="tax-input" type="text" maxLength={11} placeholder="12345678"
            value={oktmo} onChange={e => setOktmo(e.target.value)} />
        </div>
        <div className="tax-field">
          <label className="tax-label">Режим</label>
          <select className="tax-input" value={regime} onChange={e => setRegime(e.target.value as "usn6" | "usn15")}>
            <option value="usn6">УСН 6% (доходы)</option>
            <option value="usn15">УСН 15% (доходы − расходы)</option>
          </select>
        </div>
        <p style={{ fontSize: 12, color: "#8B7355", marginTop: 8 }}>
          ⚠️ Нулёвая декларация — при отсутствии доходов и расходов за год. Перед подачей согласуйте с бухгалтером.
        </p>
        <div className="tax-result-actions" style={{ marginTop: 16 }}>
          <button type="button" className="tax-download-btn" onClick={handleDownload}>
            📥 Скачать XML
          </button>
          <button type="button" className="tax-download-btn" onClick={handlePrint} style={{ marginLeft: 8 }}>
            🖨 Печать
          </button>
        </div>
      </div>
    </div>
  );
}

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
    return <ZeroView onBack={() => setActive(null)} />;
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
