import { useState } from "react";
import { QUESTIONS, type Answers } from "./questions";
import "./Questionnaire.css";

interface Props {
  onSubmit: (answers: Answers) => Promise<void>;
}

export function Questionnaire({ onSubmit }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = QUESTIONS[step]!;
  const isLast = step === QUESTIONS.length - 1;
  const canSkip = (q as { skippable?: boolean }).skippable === true;
  const allowZero = (q as { allowZero?: boolean }).allowZero === true;

  const currentValue = answers[q.id as keyof Answers] ?? "";

  function isAnswerValid(): boolean {
    if (!q.required) return true;
    const val = currentValue.trim();
    if (q.type === "number" && allowZero) {
      return val !== "" && !isNaN(Number(val));
    }
    return val !== "";
  }

  function setValue(val: string) {
    setAnswers((prev) => ({ ...prev, [q.id]: val }));
    setError(null);
  }

  function handleNext() {
    if (q.required && !isAnswerValid()) {
      setError("Пожалуйста, заполните это поле");
      return;
    }
    setStep((s) => s + 1);
  }

  function handleSkip() {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[q.id as keyof Answers];
      return next;
    });
    setStep((s) => s + 1);
  }

  function handleBack() {
    setError(null);
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
    if (q.type === "radio" && "options" in q) {
      return (
        <fieldset className="qs-fieldset">
          <legend className="qs-fieldset-legend">Выберите вариант</legend>
          {q.options.map((opt) => (
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
      return (
        <input
          type="number"
          className="qs-input"
          value={currentValue}
          onChange={(e) => setValue(e.target.value)}
          placeholder={allowZero ? "0" : "Введите число..."}
          min={allowZero ? "0" : "1"}
          step="1"
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
        placeholder="Ваш ответ..."
        autoFocus
      />
    );
  }

  return (
    <div className="qs-page">
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
            {step > 0 && (
              <button className="qs-btn qs-btn--back" onClick={handleBack} disabled={submitting}>
                Назад
              </button>
            )}

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
