/**
 * IntakePanel — оценка бизнес-плана §20.3.
 * Merged from IntakePanel + IntakeAssessment (RefineDialog, Toast).
 */

import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import type { AssumptionEntry, Gap, PlanIntake } from "./useIntake";

// ── Section labels — book-IDs (primary) + intake-IDs (backward-compat) ──────

const SECTION_LABELS: Record<string, string> = {
  // Book-IDs
  mission:        "Миссия / Резюме",
  goals:          "Цели",
  markets:        "Целевые рынки / ЦА",
  product:        "Продукт / Услуга",
  marketing:      "Маркетинг / Каналы",
  finance:        "Финансы / Деньги",
  team:           "Команда / Кадры",
  operations:     "Операционный план",
  technology:     "Технологии",
  investment:     "Инвестиционный план",
  unit_economics: "Юнит-экономика",
  risks:          "Риски",
  legal:          "Правовая структура",
  grants:         "Гранты и субсидии",
  roadmap:        "Дорожная карта",
  kpis:           "KPI",
  exit:           "Стратегия выхода",
  appendices:     "Приложения",
  sustainability: "Устойчивость",
  competitive:    "Конкурентный анализ",
  swot:           "SWOT-анализ",
  business_model: "Бизнес-модель",
  // Intake-IDs (backward-compat for data written before migration)
  executive_summary:    "Миссия / Резюме",
  finances:             "Финансы / Деньги",
  market_size:          "Объём рынка",
  market_analysis:      "Анализ рынка",
  target_audience:      "Целевая аудитория",
  product_service:      "Продукт / Услуга",
  competitive_analysis: "Конкурентный анализ",
  marketing_strategy:   "Маркетинговая стратегия",
  sales_channels:       "Каналы продаж",
  go_to_market:         "Выход на рынок",
  sales_strategy:       "Стратегия продаж",
  financial_model:      "Финансовая модель",
  investment_plan:      "Инвестиционный план",
  legal_structure:      "Правовая структура",
  grants_subsidies:     "Гранты и субсидии",
  exit_strategy:        "Стратегия выхода",
};

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key.replace(/_/g, " ");
}

function gapToQuestion(gap: Gap): string {
  if (gap.description) return `Расскажите подробнее: ${gap.description}`;
  return `Опишите раздел «${sectionLabel(gap.missingSection)}» — ключевые факты, цифры, договорённости.`;
}

// ── Assumption display ────────────────────────────────────────────────────────

const ASSUMPTION_LABELS: Record<string, string> = {
  adr_blended:        "Средний тариф/ночь",
  adr_peak:           "Тариф пиковый/ночь",
  bep_occupancy:      "Загрузка для БЕП",
  cac:                "CAC",
  capex_total:        "Капвложения (итого)",
  ebitda_margin_base: "Маржа EBITDA",
  ebitda_year2_base:  "EBITDA год 2",
  grant_agrostartup:  "Грант АгроСтартап",
  grant_minek:        "Грант Минэка",
  grant_minvostok:    "Грант Минвостокразвития",
  modules_count:      "Количество модулей",
  occupancy_annual:   "Загрузка среднегодовая",
  occupancy_peak:     "Загрузка пиковая",
  occupancy_shoulder: "Загрузка межсезонье",
  occupancy_winter:   "Загрузка зимой",
  payback_months:     "Срок окупаемости",
  revenue_year1:      "Выручка год 1",
  revenue_year2_base: "Выручка год 2",
  trip_check:         "Средний чек",
};

function formatAssumptionValue(entry: AssumptionEntry): string {
  const { value, unit } = entry;
  const isKopecks = unit === "kopecks" || unit === "₽";
  const fmt = (n: number) =>
    isKopecks
      ? (n / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽"
      : n.toLocaleString("ru-RU") + (unit ? ` ${unit}` : "");
  if (value.point !== undefined) return fmt(value.point);
  if (value.lo !== undefined && value.hi !== undefined) return `${fmt(value.lo)} – ${fmt(value.hi)}`;
  return "—";
}

// ── RefineDialog ──────────────────────────────────────────────────────────────

interface RefineDialogProps { gap: Gap; planId: string; onDone: (sectionId: string) => void; onCancel: () => void; }

function RefineDialog({ gap, planId, onDone, onCancel }: RefineDialogProps) {
  const { user } = useAuth();
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = gapToQuestion(gap);

  async function submit() {
    if (!answer.trim()) return;
    setLoading(true); setError(null);
    try {
      const idToken = await user!.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/intake-refine`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, sectionId: gap.missingSection, gapQuestion: question, answer: answer.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      const data = await res.json() as { sectionId: string };
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
      <textarea className="ia-refine-textarea" value={answer} onChange={e => setAnswer(e.target.value)}
        rows={4} placeholder="Введите ответ…" disabled={loading}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus />
      {error && <p className="ia-refine-error">{error}</p>}
      <div className="ia-refine-actions">
        <button type="button" className="ia-btn ia-btn--primary" onClick={() => void submit()} disabled={loading || !answer.trim()}>
          {loading ? "Сохраняем…" : "Отправить"}
        </button>
        <button type="button" className="ia-btn ia-btn--ghost" onClick={onCancel} disabled={loading}>Отмена</button>
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="ia-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="ia-toast-close" onClick={onClose} aria-label="Закрыть">×</button>
    </div>
  );
}

// ── IntakePanel ───────────────────────────────────────────────────────────────

interface Props {
  intake: PlanIntake | null | undefined;
  businessId?: string;
}

// Required book-ID sections for gap check
const REQUIRED = ["mission", "finance", "markets", "team", "risks"];

export function IntakePanel({ intake, businessId }: Props) {
  const [refinedSections, setRefinedSections] = useState<Set<string>>(new Set());
  const [activeGap, setActiveGap] = useState<Gap | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (intake === undefined) return <div className="ia-panel"><p className="ia-empty">Загрузка…</p></div>;
  if (intake === null) return <div className="ia-panel"><p className="ia-empty">Оценка не найдена</p></div>;

  const planId = intake.intakeId ?? businessId ?? "";
  const { assessment, disclaimer, narrativeReady } = intake;

  const coveredIds = new Set(intake.mappedSections.filter(s => s.present).map(s => s.sectionId));
  const missingRequired = REQUIRED.filter(s => !coveredIds.has(s));
  const visibleGaps = assessment.gaps.filter(g => !refinedSections.has(g.missingSection));

  function handleDone(sectionId: string) {
    setRefinedSections(prev => new Set([...prev, sectionId]));
    setActiveGap(null);
    setToast("Раздел дополнен");
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="ia-panel">
      <p className="disclaimer">{disclaimer || "«Факт-данных нет, оценка предварительная»"}</p>
      {!narrativeReady && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 12px", fontStyle: "italic" }}>
          Качественный разбор готовится
        </p>
      )}

      {/* §1 Пробелы плана */}
      {visibleGaps.length > 0 && (
        <section className="intake-section">
          <p className="intake-section-title">📋 Пробелы плана</p>
          <ul className="ia-gap-list">
            {visibleGaps.map(g => (
              <li key={g.missingSection} className="ia-gap-item">
                <div className="ia-gap-info">
                  <span className="ia-gap-name">{sectionLabel(g.missingSection)}</span>
                  {g.description && <span className="ia-gap-desc"> — {g.description}</span>}
                </div>
                {activeGap?.missingSection === g.missingSection ? (
                  <RefineDialog gap={g} planId={planId} onDone={handleDone} onCancel={() => setActiveGap(null)} />
                ) : (
                  <button type="button" className="ia-btn ia-btn--refine" onClick={() => setActiveGap(g)}>Доработать</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* §2 Недостающие обязательные разделы */}
      {missingRequired.length > 0 && (
        <section className="intake-section">
          <p className="intake-section-title">Недостающие разделы</p>
          {missingRequired.map(sec => (
            <div key={sec} style={{ marginBottom: 6, fontSize: 13, color: "var(--gray)" }}>
              Раздел «{sectionLabel(sec)}» не найден в загруженном документе
            </div>
          ))}
        </section>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
