import { useRef, useState } from "react";

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
  verdict?: string;
};

export type QA = { question: string; answer: string };

interface Props {
  advisory: Advisory;
  essence: string;
  caseId: string;
  onReset: () => void;
  onBack: () => void;
  onAnswers: (qa: QA[]) => void;
  /** Если передан — показываются кнопки 📎 у вопросов и блок «другие документы». */
  onUploadFile?: (file: File) => Promise<string>;
  /** Если передан — показываются чекбоксы на offeredDocuments и кнопка «Составить». */
  onProduce?: (selectedTitles: string[]) => void;
  /** Флаг: это уточнённый ответ (после ответов на вопросы) — скрыть повторные блоки. */
  isRefined?: boolean;
}

export function AdvisoryView({
  advisory, essence, onReset, onBack, onAnswers,
  onUploadFile, onProduce, isRefined = false,
}: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [extraDocsLoading, setExtraDocsLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set());
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const extraFileInputRef = useRef<HTMLInputElement | null>(null);

  const hasAnswers = Object.values(answers).some(v => v.trim().length > 0);
  const hasSelectedDocs = selectedDocs.size > 0;

  async function handleQuestionFile(idx: number, file: File) {
    if (!onUploadFile) return;
    setUploadingIdx(idx);
    try {
      const text = await onUploadFile(file);
      setAnswers(a => {
        const existing = (a[idx] ?? "").trim();
        return { ...a, [idx]: existing ? `${existing}\n\n${text}` : text };
      });
    } finally {
      setUploadingIdx(null);
    }
  }

  async function handleExtraFile(file: File) {
    if (!onUploadFile) return;
    setExtraDocsLoading(true);
    try {
      const text = await onUploadFile(file);
      // Добавить как дополнительный ответ с пустым вопросом — передаётся в onAnswers
      setAnswers(a => {
        const nextIdx = advisory.questions.length + Object.keys(a).filter(k => Number(k) >= advisory.questions.length).length;
        return { ...a, [nextIdx]: text };
      });
    } finally {
      setExtraDocsLoading(false);
    }
  }

  function buildQA(): QA[] {
    const questionQA = advisory.questions.map((q, i) => ({ question: q, answer: answers[i] ?? "" }));
    // extra docs (indices >= questions.length) — помечаем как вложение
    const extraQA = Object.entries(answers)
      .filter(([k]) => Number(k) >= advisory.questions.length)
      .map(([, v]) => ({ question: "Содержание прикреплённого документа", answer: v }));
    return [...questionQA, ...extraQA];
  }

  function toggleDoc(i: number) {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

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

      {/* Уточнённый вывод — показывать только verdict + суженные блоки */}
      {isRefined && advisory.verdict && (
        <section className="crm-v2-highlight" style={{ borderColor: "rgba(30,107,58,0.3)", background: "rgba(30,107,58,0.06)" }}>
          <h3 className="crm-v2-subtitle" style={{ color: "#1E6B3A" }}>Ваша позиция</h3>
          <p className="crm-v2-body">{advisory.verdict}</p>
        </section>
      )}

      {/* Первичный анализ — в collapsed если isRefined */}
      {isRefined ? (
        <details style={{ marginBottom: 0 }}>
          <summary className="crm-v2-muted" style={{ cursor: "pointer", userSelect: "none" }}>
            Первичный анализ ›
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <PrimaryAnalysis advisory={advisory} />
          </div>
        </details>
      ) : (
        <PrimaryAnalysis advisory={advisory} />
      )}

      {/* offeredDocuments — с чекбоксами если onProduce передан */}
      {advisory.offeredDocuments.length > 0 && (
        <section>
          <h3 className="crm-v2-subtitle">Документы для составления</h3>
          {onProduce ? (
            <div className="crm-v2-adv-doclist">
              {advisory.offeredDocuments.map((doc, i) => (
                <label key={i} className="crm-v2-adv-docitem">
                  <input
                    type="checkbox"
                    className="crm-v2-adv-checkbox"
                    checked={selectedDocs.has(i)}
                    onChange={() => toggleDoc(i)}
                  />
                  <span className="crm-v2-body">{doc}</span>
                </label>
              ))}
              <button
                type="button"
                className="crm-v2-btn-primary"
                style={{ marginTop: 8 }}
                disabled={!hasSelectedDocs}
                onClick={() => {
                  const titles = [...selectedDocs].sort().map(i => advisory.offeredDocuments[i]!);
                  onProduce(titles);
                }}
              >
                Составить выбранные
              </button>
            </div>
          ) : (
            <ul className="crm-v2-list">
              {advisory.offeredDocuments.map((doc, i) => (
                <li key={i} className="crm-v2-list-item">{doc}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Блок вопросов с полями и загрузкой файлов */}
      {advisory.questions.length > 0 && (
        <section className="crm-v2-adv-questions">
          <h3 className="crm-v2-subtitle">Уточните — дам точную позицию</h3>
          {advisory.questions.map((q, i) => (
            <div key={i} className="crm-v2-adv-qitem">
              <div className="crm-v2-adv-qlabel-row">
                <label className="crm-v2-adv-qlabel">{i + 1}. {q}</label>
                {onUploadFile && (
                  <>
                    <button
                      type="button"
                      className="crm-v2-adv-attach-btn"
                      disabled={uploadingIdx === i}
                      onClick={() => fileInputRefs.current[i]?.click()}
                    >
                      {uploadingIdx === i ? "загружаю…" : "📎 документ"}
                    </button>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.txt"
                      style={{ display: "none" }}
                      ref={el => { fileInputRefs.current[i] = el; }}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) void handleQuestionFile(i, f);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
              </div>
              <textarea
                className="crm-v2-adv-qinput"
                rows={2}
                value={answers[i] ?? ""}
                onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                placeholder="Ваш ответ"
              />
            </div>
          ))}

          {/* Блок «Другие документы по делу» */}
          {onUploadFile && (
            <div className="crm-v2-adv-extradocs">
              <p className="crm-v2-muted" style={{ marginBottom: 8 }}>
                Есть другие документы по делу? Kairos извлечёт из них факты.
              </p>
              <button
                type="button"
                className="crm-v2-adv-attach-btn"
                disabled={extraDocsLoading}
                onClick={() => extraFileInputRef.current?.click()}
              >
                {extraDocsLoading ? "загружаю…" : "📎 Загрузить документ"}
              </button>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.txt"
                style={{ display: "none" }}
                ref={extraFileInputRef}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleExtraFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          <button
            type="button"
            className="crm-v2-btn-primary"
            disabled={!hasAnswers}
            onClick={() => onAnswers(buildQA())}
          >
            Получить точную позицию и документы
          </button>
        </section>
      )}

      <p className="crm-v2-muted" style={{ fontSize: 12 }}>{advisory.disclaimer}</p>
    </div>
  );
}

// ── Первичный анализ (используется и раскрытом, и свёрнутом виде) ─────────────

function PrimaryAnalysis({ advisory }: { advisory: Advisory }) {
  return (
    <>
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
    </>
  );
}
