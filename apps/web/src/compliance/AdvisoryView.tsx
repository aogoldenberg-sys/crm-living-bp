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

interface Props {
  advisory: Advisory;
  essence: string;
  caseId: string;
  onReset: () => void;
}

export function AdvisoryView({ advisory, essence, onReset }: Props) {
  return (
    <div className="crm-v2-panel">
      <p className="crm-v2-muted" style={{ marginBottom: 8 }}>{essence}</p>

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

      {advisory.questions.length > 0 && (
        <section>
          <h3 className="crm-v2-subtitle">Уточняющие вопросы</h3>
          <ul className="crm-v2-list">
            {advisory.questions.map((q, i) => (
              <li key={i} className="crm-v2-list-item">{q}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="crm-v2-muted" style={{ marginTop: 16, fontSize: 12 }}>{advisory.disclaimer}</p>
      <button type="button" className="crm-v2-btn-secondary" onClick={onReset}>
        Загрузить другой документ
      </button>
    </div>
  );
}
