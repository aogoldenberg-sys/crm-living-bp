import { useState } from "react";

export type RegistryRow = {
  entryId: string;
  docKind: string;
  label: string;
  resolution: "provided" | "duplicate" | "pending_scan" | "missing" | "not_applicable";
};

interface Props {
  caseId: string;
  letter: string;
  registry: RegistryRow[];
}

const RESOLUTION_LABEL: Record<string, string> = {
  provided: "📄 Оригинал",
  duplicate: "📋 Дубликат",
  pending_scan: "🔎 На бумаге (сканировать)",
  missing: "⚠️ Отсутствует",
  not_applicable: "— Не применимо",
};

export function PackageResult({ letter, registry }: Props) {
  const [letterText, setLetterText] = useState(letter);

  function handlePrint() {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Письмо-ответ</title>
      <style>body{font-family:Arial,sans-serif;font-size:14px;padding:40px}p{white-space:pre-wrap;margin-top:20px}</style>
      </head><body><h1>Ответ на требование</h1><p>${letterText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  const provided = registry.filter(r => r.resolution === "provided" || r.resolution === "duplicate" || r.resolution === "pending_scan");
  const absent = registry.filter(r => r.resolution === "missing" || r.resolution === "not_applicable");

  return (
    <div className="crm-v2-panel">
      <h2 className="crm-v2-title">✅ Пакет готов</h2>

      <div className="crm-v2-disclaimer">
        ⚠️ Проект. Перед отправкой проверьте с юристом.
      </div>

      {/* Document registry */}
      {provided.length > 0 && (
        <section className="crm-v2-group">
          <p className="crm-v2-group-text">Документы к представлению</p>
          {provided.map(r => (
            <div key={r.entryId} className="crm-v2-entry">
              <span className="crm-v2-entry-label">{r.label}</span>
              <span className="crm-v2-badge-sm">{RESOLUTION_LABEL[r.resolution]}</span>
            </div>
          ))}
        </section>
      )}

      {absent.length > 0 && (
        <section className="crm-v2-group">
          <p className="crm-v2-group-text">Пояснения по отсутствующим</p>
          {absent.map(r => (
            <div key={r.entryId} className="crm-v2-entry">
              <span className="crm-v2-entry-label">{r.label}</span>
              <span className="crm-v2-badge-sm">{RESOLUTION_LABEL[r.resolution]}</span>
            </div>
          ))}
        </section>
      )}

      {/* Letter */}
      <p className="crm-v2-label">Сопроводительное письмо</p>
      <textarea
        className="crm-v2-letter"
        value={letterText}
        onChange={e => setLetterText(e.target.value)}
        rows={12}
      />

      <div className="crm-v2-actions">
        <button type="button" className="crm-v2-btn" onClick={handlePrint}>
          🖨 Печать
        </button>
      </div>
    </div>
  );
}
