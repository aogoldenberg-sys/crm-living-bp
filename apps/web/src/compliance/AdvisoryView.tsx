import { useState } from "react";

// Advisory type mirrors packages/ai-kit/src/compliance/advise.ts
// Defined locally to avoid importing a backend package into the web app.
export type Advisory = {
  essence: string;
  legalGround: string;
  notApplicable: string[];
  consequences: string;
  options: string[];
  questions: string[];
  offeredDocuments: string[];
  disclaimer: string;
};

export type QA = { question: string; answer: string };

interface Props {
  advisory: Advisory;
  essence: string;
  caseId: string;
  onReset: () => void;
  onBack: () => void;
  onAnswers: (qa: QA[]) => void;
}

export function AdvisoryView({ advisory, essence, onReset, onBack, onAnswers }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const hasAnswers = Object.values(answers).some(v => v.trim().length > 0);

  return (
    <div className="crm-v2-panel">
      <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
        <button type="button" className="crm-v2-btn-secondary" onClick={onBack}>
          ← К списку кейсов
        </button>
        <button type="button" className="crm-v2-btn-secondary" onClick={onReset}>
          Новый кейс
        </button>
      </div>

      {essence && <p className="crm-v2-muted" style={{ marginBottom: 8 }}>{essence}</p>}

      <section>
        <h3 className="crm-v2-subtitle">Суть документа</h3>
        <p className="crm-v2-body">{advisory.essence}</p>
      </section>

      <section>
        <h3 className="crm-v2-subtitle">Правовое основание</h3>
        <p className="crm-v2-body">{advisory.legalGround}</p>
      </section>

      {advisory.notApplicable.length > 0 && (
        <section className="crm-v2-highlight">
          <h3 className="crm-v2-subtitle">Когда мера неприменима</h3>
          <ul className="crm-v2-list">
            {advisory.notApplicable.map((item, i) => (
              <li key={i} className="crm-v2-list-item">{item}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="crm-v2-subtitle">Последствия</h3>
        <p className="crm-v2-body">{advisory.consequences}</p>
      </section>

      {advisory.options.length > 0 && (
        <section>
          <h3 className="crm-v2-subtitle">Что делать</h3>
          <ol className="crm-v2-list">
            {advisory.options.map((opt, i) => (
              <li key={i} className="crm-v2-list-item">{opt}</li>
            ))}
          </ol>
        </section>
      )}

      {advisory.offeredDocuments.length > 0 && (
        <section>
          <h3 className="crm-v2-subtitle">Документы для составления</h3>
          <ul className="crm-v2-list">
            {advisory.offeredDocuments.map((doc, i) => (
              <li key={i} className="crm-v2-list-item">{doc}</li>
            ))}
          </ul>
        </section>
      )}

      {advisory.questions.length > 0 && (
        <section className="crm-v2-adv-questions">
          <h3 className="crm-v2-subtitle">Уточните — дам точную позицию</h3>
          {advisory.questions.map((q, i) => (
            <div key={i} className="crm-v2-adv-qitem">
              <label className="crm-v2-adv-qlabel">{i + 1}. {q}</label>
              <textarea
                className="crm-v2-adv-qinput"
                rows={2}
                value={answers[i] ?? ""}
                onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                placeholder="Ваш ответ"
              />
            </div>
          ))}
          <button
            type="button"
            className="crm-v2-btn-primary"
            disabled={!hasAnswers}
            onClick={() => onAnswers(advisory.questions.map((q, i) => ({ question: q, answer: answers[i] ?? "" })))}
          >
            Получить точную позицию и документы
          </button>
        </section>
      )}

      <p className="crm-v2-muted" style={{ fontSize: 12 }}>{advisory.disclaimer}</p>
    </div>
  );
}
