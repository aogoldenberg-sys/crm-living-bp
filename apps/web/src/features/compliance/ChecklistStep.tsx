import { caseCompleteness } from "@crm/core";
import type { ChecklistEntry, ComplianceCase, DocAvailability } from "@crm/schemas";
import "./ComplianceFlow.css";

interface Props {
  caseData: ComplianceCase;
  onChange: (updated: ComplianceCase) => void;
}

function AvailabilityBadge({ avail }: { avail: DocAvailability }) {
  switch (avail) {
    case "have_file":
      return <span className="compliance-badge compliance-badge--green">Есть файл</span>;
    case "have_paper":
      return <span className="compliance-badge compliance-badge--blue">На бумаге</span>;
    case "restorable":
      return (
        <span className="compliance-badge compliance-badge--yellow">
          Восстановим
        </span>
      );
    case "missing_no_event":
      return <span className="compliance-badge compliance-badge--grey">Отсутствует</span>;
    case "not_applicable":
      return <span className="compliance-badge compliance-badge--grey">Не применимо</span>;
    default:
      return null;
  }
}

function toggleEntry(caseData: ComplianceCase, entryId: string): ComplianceCase {
  return {
    ...caseData,
    checklist: caseData.checklist.map(e =>
      e.entryId === entryId ? { ...e, confirmedByOwner: !e.confirmedByOwner } : e
    ),
  };
}

export function ChecklistStep({ caseData, onChange }: Props) {
  const completeness = caseCompleteness(caseData.checklist);
  const pct = Math.round(completeness * 100);

  // group by requestItemId
  const grouped = new Map<string, ChecklistEntry[]>();
  for (const entry of caseData.checklist) {
    const list = grouped.get(entry.requestItemId) ?? [];
    list.push(entry);
    grouped.set(entry.requestItemId, list);
  }

  function handleAssemble() {
    onChange({ ...caseData, status: "assembling" });
  }

  return (
    <div className="compliance-checklist">
      <div className="compliance-checklist-header">
        <h2 className="compliance-checklist-title">Чек-лист документов</h2>
        <span className="compliance-badge compliance-badge--yellow">{caseData.status}</span>
      </div>

      {/* Progress */}
      <div className="compliance-progress">
        <div className="compliance-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#8B7355" }}>
        Готовность пакета: <strong>{pct}%</strong>
      </p>

      {/* Groups */}
      {caseData.items.map(item => {
        const entries = grouped.get(item.itemId) ?? [];
        return (
          <div key={item.itemId} className="compliance-group">
            <p className="compliance-group-title">
              {item.rawText.length > 80 ? item.rawText.slice(0, 80) + "…" : item.rawText}
            </p>
            {entries.map(entry => (
              <div key={entry.entryId} className="compliance-entry">
                <div style={{ flex: 1 }}>
                  <p className="compliance-entry-label">{entry.label}</p>
                  {entry.availability === "restorable" && entry.evidence.length > 0 && (
                    <p className="compliance-entry-sub">Основание: {entry.evidence.length} операций</p>
                  )}
                </div>
                <div className="compliance-entry-right">
                  <AvailabilityBadge avail={entry.availability} />
                  <input
                    type="checkbox"
                    className="compliance-checkbox"
                    checked={entry.confirmedByOwner}
                    onChange={() => onChange(toggleEntry(caseData, entry.entryId))}
                    aria-label={`Подтвердить: ${entry.label}`}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      })}

      <button className="compliance-assemble-btn" onClick={handleAssemble} type="button">
        Собрать пакет
      </button>
    </div>
  );
}
