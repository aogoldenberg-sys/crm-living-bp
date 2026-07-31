import { useState } from "react";
import type { RequestItem } from "@crm/schemas";
import type { ClarifyAnswer } from "./ComplianceV2.js";

interface Props {
  openItems: RequestItem[];
  onSubmit: (answers: ClarifyAnswer[]) => void;
}

type Status = "have_paper" | "not_applicable" | "missing";

export function ClarifyDialog({ openItems, onSubmit }: Props) {
  const [statuses, setStatuses] = useState<Record<string, Status>>(() =>
    Object.fromEntries(openItems.map(it => [it.itemId, "missing" as Status])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  function setStatus(itemId: string, status: Status) {
    setStatuses(prev => ({ ...prev, [itemId]: status }));
  }

  function setNote(itemId: string, note: string) {
    setNotes(prev => ({ ...prev, [itemId]: note }));
  }

  function handleSubmit() {
    const answers: ClarifyAnswer[] = openItems.map(it => ({
      itemId: it.itemId,
      status: statuses[it.itemId] ?? "missing",
      note: notes[it.itemId]?.trim() || null,
    }));
    onSubmit(answers);
  }

  return (
    <div className="crm-v2-panel">
      <h2 className="crm-v2-title">Уточните отсутствующие документы</h2>
      <p className="crm-v2-sub">
        Для каждого пункта укажите, где находится документ.
      </p>

      {openItems.map(item => (
        <div key={item.itemId} className="crm-v2-group">
          <p className="crm-v2-group-text">
            {item.rawText.length > 100 ? item.rawText.slice(0, 100) + "…" : item.rawText}
          </p>

          <div className="crm-v2-radio-group">
            {(["have_paper", "not_applicable", "missing"] as Status[]).map(s => (
              <label key={s} className="crm-v2-radio-label">
                <input
                  type="radio"
                  name={item.itemId}
                  value={s}
                  checked={statuses[item.itemId] === s}
                  onChange={() => setStatus(item.itemId, s)}
                />
                {s === "have_paper" && "Есть на бумаге / сканирую"}
                {s === "not_applicable" && "Не наша операция"}
                {s === "missing" && "Действительно отсутствует"}
              </label>
            ))}
          </div>

          {statuses[item.itemId] !== "not_applicable" && (
            <input
              type="text"
              className="crm-v2-note"
              placeholder="Пояснение (необязательно)"
              value={notes[item.itemId] ?? ""}
              onChange={e => setNote(item.itemId, e.target.value)}
            />
          )}
        </div>
      ))}

      <button type="button" className="crm-v2-btn" onClick={handleSubmit}>
        Продолжить
      </button>
    </div>
  );
}
