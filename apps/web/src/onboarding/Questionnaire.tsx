import { useState } from "react";
import { QUESTIONS, type Answers } from "./questions";
import "./Questionnaire.css";

interface Props {
  onSubmit: (answers: Answers) => Promise<void>;
  onHome: () => void;
}

// For radio_with_text: store as "radio_value\ndetail" (detail optional)
function parseRadioWithText(val: string): [string, string] {
  const idx = val.indexOf("\n");
  if (idx === -1) return [val, ""];
  return [val.slice(0, idx), val.slice(idx + 1)];
}

function buildRadioWithText(radio: string, detail: string): string {
  return detail.trim() ? `${radio}\n${detail}` : radio;
}

export function Questionnaire({ onSubmit, onHome }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = QUESTIONS[step]!;
  const isLast = step === QUESTIONS.length - 1;
  const canSkip = (q as { skippable?: boolean }).skippable === true;
  const qPlaceholder = (q as { placeholder?: string }).placeholder;
  const qTextPlaceholder = (q as { textPlaceholder?: string }).textPlaceholder;
  const qTextOnlyFor = (q as { textOnlyFor?: string }).textOnlyFor;

  const currentValue = answers[q.id as keyof Answers] ?? "";

  function isAnswerValid(): boolean {
    if (!q.required) return true;
    if (q.type === "radio_with_text") {
      const [radio] = parseRadioWithText(currentValue);
      return radio.trim() !== "";
    }
    return currentValue.trim() !== "";
  }

  function setValue(val: string) {
    setAnswers((prev) => ({ ...prev, [q.id]: val }));
    setError(null);
  }

  function handleNext() {
    if (q.required && !isAnswerValid()) {
      setError("Пожалуйста, выберите вариант");
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  }

  function handleSkip() {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[q.id as keyof Answers];
      return next;
    });
    setError(null);
    setStep((s) => s + 1);
  }

  function handleBack() {
    setError(null);
    if (step === 0) { onHome(); return; }
    setStep((s) => s - 1);
  }

  async function handleSubmit() {
    if (q.required && !isAnswerValid()) {
      setError("Пожалуйста, заполните это поле");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(answers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отправки. Попробуйте ещё раз.");
      setSubmitting(false);
    }
  }

  function renderInput() {
    // Radio + optional text clarification (q1)
    if (q.type === "radio_with_text" && "options" in q) {
      const [radioVal, detail] = parseRadioWithText(currentValue);
      return (
        <>
          <fieldset className="qs-fieldset">
            <legend className="qs-fieldset-legend">Выберите вариант</legend>
            {(q as { options: readonly string[] }).options.map((opt) => (
              <label key={opt} className={`qs-radio-label${radioVal === opt ? " qs-radio-label--selected" : ""}`}>
                <input
                  type="radio"
                  name={q.id}
                  value={opt}
                  checked={radioVal === opt}
                  onChange={(e) => setValue(buildRadioWithText(e.target.value, detail))}
                  className="qs-radio-input"
                />
                <span className="qs-radio-text">{opt}</span>
              </label>
            ))}
          </fieldset>
          {(!qTextOnlyFor || radioVal === qTextOnlyFor) && (
            <input
              type="text"
              className="qs-input qs-input--detail"
              value={detail}
              onChange={(e) => setValue(buildRadioWithText(radioVal, e.target.value))}
              placeholder={qTextPlaceholder ?? "Уточните..."}
            />
          )}
        </>
      );
    }

    if (q.type === "radio" && "options" in q) {
      return (
        <fieldset className="qs-fieldset">
          <legend className="qs-fieldset-legend">Выберите вариант</legend>
          {(q as { options: readonly string[] }).options.map((opt) => (
            <label key={opt} className={`qs-radio-label${currentValue === opt ? " qs-radio-label--selected" : ""}`}>
              <input
                type="radio"
                name={q.id}
                value={opt}
                checked={currentValue === opt}
                onChange={(e) => setValue(e.target.value)}
                className="qs-radio-input"
              />
              <span className="qs-radio-text">{opt}</span>
            </label>
          ))}
        </fieldset>
      );
    }

    if (q.type === "textarea") {
      return (
        <textarea
          className="qs-textarea"
          value={currentValue}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ваш ответ..."
          rows={5}
          autoFocus
        />
      );
    }

    if (q.type === "number") {
      // type="text" + inputMode — no browser spinner arrows
      return (
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="qs-input"
          value={currentValue}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, "");
            setValue(v);
          }}
          placeholder={qPlaceholder ?? "0"}
          autoFocus
        />
      );
    }

    // default: text
    return (
      <input
        type="text"
        className="qs-input"
        value={currentValue}
        onChange={(e) => setValue(e.target.value)}
        placeholder={qPlaceholder ?? "Ваш ответ..."}
        autoFocus
      />
    );
  }

  const backLabel = step === 0 ? "← На главную" : "Назад";

  return (
    <div className="qs-page">
      {/* Шапка с логотипом */}
      <div className="qs-header">
        <button className="qs-logo-btn" onClick={onHome} aria-label="На главный экран">
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="3" y1="8" x2="25" y2="20" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>Kairos</span>
        </button>
      </div>

      {/* Прогресс */}
      <div className="qs-progress-bar" role="progressbar" aria-valuenow={step + 1} aria-valuemax={QUESTIONS.length}>
        <div
          className="qs-progress-fill"
          style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }}
        />
      </div>

      <div className="qs-container">
        <div className="qs-counter">{step + 1} из {QUESTIONS.length}</div>

        <div className="qs-card">
          <h2 className="qs-question">{q.text}</h2>

          <div className="qs-input-wrap">
            {renderInput()}
          </div>

          {error && (
            <p className="qs-error" role="alert">{error}</p>
          )}

          <div className="qs-actions">
            <button className="qs-btn qs-btn--back" onClick={handleBack} disabled={submitting}>
              {backLabel}
            </button>

            <div className="qs-actions-right">
              {canSkip && (
                <button className="qs-btn qs-btn--skip" onClick={handleSkip} disabled={submitting}>
                  Пропустить
                </button>
              )}

              {isLast ? (
                <button
                  className="qs-btn qs-btn--primary"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? "Отправка…" : "Готово"}
                </button>
              ) : (
                <button
                  className="qs-btn qs-btn--primary"
                  onClick={handleNext}
                  disabled={submitting}
                >
                  Далее
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
