/**
 * IntakeAssessment — §20.3 симметричная оценка бизнес-плана.
 *
 * 3 секции всегда: сильные стороны / риски / пробелы.
 * Каждый пробел: кнопка «Доработать» → диалог → POST /intake-refine → исчезает.
 */

import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import type { Gap, PlanIntake } from "../dashboard/useIntake";

// ── Типы ────────────────────────────────────────────────────────────────────────

export interface RefinementEntry {
  timestamp: string;
  question: string;
  answer: string;
}

interface RefineResponse {
  sectionId: string;
  appended: string;
  changelog: RefinementEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  executive_summary: "Резюме",
  finances: "Финансы",
  market_size: "Объём рынка",
  market_analysis: "Анализ рынка",
  target_audience: "Целевая аудитория",
  product_service: "Продукт / услуга",
  business_model: "Бизнес-модель",
  competitive_analysis: "Конкурентный анализ",
  marketing_strategy: "Маркетинговая стратегия",
  sales_strategy: "Стратегия продаж",
  operations: "Операционный план",
  team: "Команда",
  technology: "Технологии",
  financial_model: "Финансовая модель",
  investment_plan: "Инвестиционный план",
  unit_economics: "Юнит-экономика",
  risks: "Риски",
  legal_structure: "Правовая структура",
  grants_subsidies: "Гранты и субсидии",
  roadmap: "Дорожная карта",
  kpis: "KPI",
  exit_strategy: "Стратегия выхода",
  appendices: "Приложения",
  sustainability: "Устойчивость",
};

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key;
}

/** Derive a plain-language question from a gap description. */
function gapToQuestion(gap: Gap): string {
  if (gap.description) return `Расскажите подробнее: ${gap.description}`;
  return `Опишите раздел «${sectionLabel(gap.missingSection)}» — ключевые факты, цифры, договорённости.`;
}

// ── Refinement dialog (inline) ────────────────────────────────────────────────

interface RefineDialogProps {
  gap: Gap;
  planId: string;
  onDone: (sectionId: string) => void;
  onCancel: () => void;
}

function RefineDialog({ gap, planId, onDone, onCancel }: RefineDialogProps) {
  const { user } = useAuth();
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = gapToQuestion(gap);

  async function submit() {
    if (!answer.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user!.getIdToken();
      const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
      const res = await fetch(`${workerUrl}/intake-refine`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planId,
          sectionId: gap.missingSection,
          gapQuestion: question,
          answer: answer.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      const data = await res.json() as RefineResponse;
      onDone(data.sectionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ia-refine-dialog">
      <p className="ia-refine-question">{question}</p>
      <textarea
        className="ia-refine-textarea"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={4}
        placeholder="Введите ответ…"
        disabled={loading}
        // РЕШЕНИЕ: autoFocus здесь UX-обязательно — диалог открывается при клике
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      {error && <p className="ia-refine-error">{error}</p>}
      <div className="ia-refine-actions">
        <button
          type="button"
          className="ia-btn ia-btn--primary"
          onClick={() => void submit()}
          disabled={loading || !answer.trim()}
        >
          {loading ? "Сохраняем…" : "Отправить"}
        </button>
        <button
          type="button"
          className="ia-btn ia-btn--ghost"
          onClick={onCancel}
          disabled={loading}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  onClose: () => void;
}

function Toast({ message, onClose }: ToastProps) {
  return (
    <div className="ia-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="ia-toast-close" onClick={onClose} aria-label="Закрыть">×</button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  intake: PlanIntake;
  planId: string;
}

export function IntakeAssessment({ intake, planId }: Props) {
  const { assessment, disclaimer } = intake;

  // sectionIds of gaps that have been refined (disappear from list)
  const [refinedSections, setRefinedSections] = useState<Set<string>>(new Set());
  // which gap has its refine dialog open
  const [activeGap, setActiveGap] = useState<Gap | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function handleDone(sectionId: string) {
    setRefinedSections((prev) => new Set([...prev, sectionId]));
    setActiveGap(null);
    setToast("Раздел дополнен");
    setTimeout(() => setToast(null), 3000);
  }

  const visibleGaps = assessment.gaps.filter(
    (g) => !refinedSections.has(g.missingSection),
  );

  return (
    <div className="ia-panel">
      {/* ── Disclaimer — всегда видим ────────────────────────────────── */}
      <p className="disclaimer">«Факт-данных нет, оценка предварительная»</p>

      {/* ── §1 Сильные стороны ──────────────────────────────────────── */}
      <section className="intake-section">
        <p className="intake-section-title">✅ Сильные стороны</p>
        {assessment.strengths.length > 0 ? (
          <ul className="ia-list">
            {assessment.strengths.map((s, i) => (
              <li key={i} className="ia-list-item ia-list-item--green">
                {s}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ia-empty">Сильные стороны не выявлены</p>
        )}
      </section>

      {/* ── §2 Риски и замечания ────────────────────────────────────── */}
      <section className="intake-section">
        <p className="intake-section-title">⚠️ Риски и замечания</p>
        {assessment.concerns.length > 0 ? (
          <ul className="ia-list">
            {assessment.concerns.map((c, i) => (
              <li
                key={i}
                className={`ia-list-item ${c.severity === "red" ? "ia-list-item--red" : "ia-list-item--yellow"}`}
                title={c.rationale ?? undefined}
              >
                <span className={`ia-severity-dot ia-severity-dot--${c.severity}`} />
                {c.description}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ia-empty">Критичных рисков не выявлено</p>
        )}
      </section>

      {/* ── §3 Пробелы ──────────────────────────────────────────────── */}
      <section className="intake-section">
        <p className="intake-section-title">📋 Пробелы</p>
        {visibleGaps.length > 0 ? (
          <ul className="ia-gap-list">
            {visibleGaps.map((g) => (
              <li key={g.missingSection} className="ia-gap-item">
                <div className="ia-gap-info">
                  <span className="ia-gap-name">{sectionLabel(g.missingSection)}</span>
                  {g.description && (
                    <span className="ia-gap-desc"> — {g.description}</span>
                  )}
                </div>
                {activeGap?.missingSection === g.missingSection ? (
                  <RefineDialog
                    gap={g}
                    planId={planId}
                    onDone={handleDone}
                    onCancel={() => setActiveGap(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="ia-btn ia-btn--refine"
                    onClick={() => setActiveGap(g)}
                  >
                    Доработать
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ia-empty">
            {assessment.gaps.length > 0
              ? "Все пробелы устранены"
              : "Пробелов не выявлено"}
          </p>
        )}
      </section>

      {/* ── Additional disclaimer from server ──────────────────────── */}
      {disclaimer && disclaimer !== "«Факт-данных нет, оценка предварительная»" && (
        <p className="disclaimer" style={{ marginTop: 8 }}>{disclaimer}</p>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
