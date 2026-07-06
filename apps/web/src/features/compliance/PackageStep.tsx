import type { ComplianceCase } from "@crm/schemas";
import "./ComplianceFlow.css";

interface Props {
  caseData: ComplianceCase;
  onChange: (updated: ComplianceCase) => void;
}

function makeGoogleCalendarUrl(title: string, date: string): string {
  // date format: YYYY-MM-DD → YYYYMMDD
  const d = date.replace(/-/g, "");
  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${d}/${d}`
  );
}

export function PackageStep({ caseData, onChange }: Props) {
  // docs to include: have_file + restorable that are confirmed
  const docEntries = caseData.checklist.filter(
    e => e.availability === "have_file" || e.availability === "restorable"
  );

  function updateLetterDraft(draft: string) {
    if (!caseData.response) return;
    onChange({
      ...caseData,
      response: { ...caseData.response, letterDraft: draft },
    });
  }

  function handleDone() {
    onChange({ ...caseData, status: "done" });
  }

  const deadline = caseData.response?.deadline ?? null;
  const letterDraft = caseData.response?.letterDraft ?? "";

  return (
    <div className="compliance-package">
      <h2 className="compliance-package-title">Пакет документов</h2>

      {/* Document list */}
      <ul className="compliance-doc-list">
        {docEntries.map(entry => {
          const isDuplicate = entry.availability === "restorable";
          return (
            <li
              key={entry.entryId}
              className={"compliance-doc-item" + (isDuplicate ? " compliance-doc-item--duplicate" : "")}
            >
              <span className="compliance-doc-icon">{isDuplicate ? "📋" : "📄"}</span>
              <span>
                {isDuplicate ? `ДУБЛИКАТ. Оригинал: ${entry.label}` : entry.label}
              </span>
            </li>
          );
        })}
        {docEntries.length === 0 && (
          <li className="compliance-doc-item" style={{ color: "#AAA098", fontStyle: "italic" }}>
            Нет подтверждённых документов
          </li>
        )}
      </ul>

      {/* Deadline */}
      {deadline && (
        <div className="compliance-deadline">
          <span>📅 Срок ответа: <strong>{deadline}</strong></span>
          <a
            className="compliance-calendar-link"
            href={makeGoogleCalendarUrl("Срок ответа на требование", deadline)}
            target="_blank"
            rel="noreferrer"
          >
            Добавить в календарь
          </a>
        </div>
      )}

      {/* Disclaimer — always visible, above textarea */}
      <div className="compliance-disclaimer">
        ⚠️ Проект. Перед отправкой проверьте с юристом.
      </div>

      {/* Letter */}
      <p className="compliance-letter-label">Сопроводительное письмо</p>
      <textarea
        className="compliance-letter"
        value={letterDraft}
        onChange={e => updateLetterDraft(e.target.value)}
        placeholder="Текст мотивированного ответа..."
      />

      <button className="compliance-done-btn" onClick={handleDone} type="button">
        Готово
      </button>
    </div>
  );
}
