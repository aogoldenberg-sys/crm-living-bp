import { useState } from "react";
import type { RequestItem } from "@crm/schemas";
import type { ClarifyAnswer } from "./ComplianceV2.js";

interface Props {
  openItems: RequestItem[];
  /** Вызывается с сырым текстом ответа — парсинг на сервере */
  onSubmit: (userAnswer: string) => void;
}

export function ClarifyDialog({ openItems, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [showRadio, setShowRadio] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ClarifyAnswer["status"]>>(() =>
    Object.fromEntries(openItems.map(it => [it.itemId, "missing" as ClarifyAnswer["status"]])),
  );

  function handleTextSubmit() {
    onSubmit(text.trim() || "нет ответа");
  }

  function handleRadioSubmit() {
    // Преобразуем выборы радио-кнопок в читаемый текст для parseClarifyAnswers
    const lines = openItems.map((it, i) => {
      const s = statuses[it.itemId] ?? "missing";
      const label = s === "have_paper" ? "есть на бумаге" : s === "not_applicable" ? "не наша операция" : "отсутствует";
      return `${i + 1}. ${label}`;
    });
    onSubmit(lines.join(", "));
  }

  if (showRadio) {
    return (
      <div className="crm-v2-panel">
        <h2 className="crm-v2-title">Уточните отсутствующие документы</h2>
        {openItems.map((item, i) => (
          <div key={item.itemId} className="crm-v2-group">
            <p className="crm-v2-group-text">
              {i + 1}. {item.rawText.length > 100 ? item.rawText.slice(0, 100) + "…" : item.rawText}
            </p>
            <div className="crm-v2-radio-group">
              {(["have_paper", "not_applicable", "missing"] as ClarifyAnswer["status"][]).map(s => (
                <label key={s} className="crm-v2-radio-label">
                  <input
                    type="radio"
                    name={item.itemId}
                    value={s}
                    checked={statuses[item.itemId] === s}
                    onChange={() => setStatuses(prev => ({ ...prev, [item.itemId]: s }))}
                  />
                  {s === "have_paper" && "Есть на бумаге / сканирую"}
                  {s === "not_applicable" && "Не наша операция"}
                  {s === "missing" && "Действительно отсутствует"}
                </label>
              ))}
            </div>
          </div>
        ))}
        <button type="button" className="crm-v2-btn" onClick={handleRadioSubmit}>
          Продолжить
        </button>
        <button type="button" className="crm-v2-link" onClick={() => setShowRadio(false)}>
          ← Назад
        </button>
      </div>
    );
  }

  return (
    <div className="crm-v2-panel">
      <h2 className="crm-v2-title">Уточните отсутствующие документы</h2>
      <p className="crm-v2-sub">
        Опишите коротко — что есть, чего нет и почему.
      </p>
      <p className="crm-v2-sub crm-v2-hint">
        Пример: «1 — есть на бумаге, 2 — два из трёх договоров, 3 — операции не было»
      </p>

      <textarea
        className="crm-v2-letter"
        rows={5}
        placeholder="Можно кратко: 1-да, 2-два из трёх, 3-нет"
        value={text}
        onChange={e => setText(e.target.value)}
        autoFocus
      />

      <p className="crm-v2-sub crm-v2-muted">
        Позиции из требования ({openItems.length} шт.):
      </p>
      <ol className="crm-v2-open-list">
        {openItems.map((it, i) => (
          <li key={it.itemId}>
            {i + 1}. {it.rawText.length > 80 ? it.rawText.slice(0, 80) + "…" : it.rawText}
          </li>
        ))}
      </ol>

      <div className="crm-v2-actions">
        <button type="button" className="crm-v2-btn" onClick={handleTextSubmit}>
          Продолжить
        </button>
        <button type="button" className="crm-v2-link" onClick={() => setShowRadio(true)}>
          Ответить по пунктам
        </button>
      </div>
    </div>
  );
}
