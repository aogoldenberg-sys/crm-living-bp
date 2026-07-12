/**
 * RoadmapPanel — дорожная карта с ИД-логикой (A1/A2/A3).
 *
 * Центр дашборда когда нет фактических сделок.
 * Строится детерминированно из intake-оценки, без Claude.
 *
 * Block 5: добавлены чекбокс «Сделано», кнопки действий, фильтр по фазам.
 */

import { useMemo, useState } from "react";
import { buildRoadmap } from "@crm/core";
import type { Roadmap, RoadmapItem } from "@crm/core";
import type { PlanIntake } from "./useIntake";

// ── Типы состояния ─────────────────────────────────────────────────────────────

type PhaseFilter = "all" | "current" | "done" | "future";

const PHASE_LABELS: Record<PhaseFilter, string> = {
  all: "Все",
  current: "Текущие",
  done: "Завершённые",
  future: "Будущие",
};

const PHASE_CYCLE: PhaseFilter[] = ["all", "current", "done", "future"];

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsDoneKey(businessId: string, itemId: string): string {
  return `roadmap_done_${businessId}_${itemId}`;
}

function lsActionKey(businessId: string, itemId: string): string {
  return `roadmap_action_${businessId}_${itemId}`;
}

function isDone(businessId: string, itemId: string): boolean {
  return localStorage.getItem(lsDoneKey(businessId, itemId)) === "true";
}

function getAction(businessId: string, itemId: string): string | null {
  return localStorage.getItem(lsActionKey(businessId, itemId));
}

// ── Автономия-бейджи ──────────────────────────────────────────────────────────

const AUTONOMY_LABEL: Record<string, string> = {
  A1: "к сведению",
  A2: "авто",
  A3: "ждёт решения",
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function AutonomyBadge({ autonomy }: { autonomy: string }) {
  return (
    <span className={`rm-badge rm-badge--${autonomy.toLowerCase()}`}>
      {AUTONOMY_LABEL[autonomy] ?? autonomy}
    </span>
  );
}

// ── Кнопка действия (зависит от phase + autonomy) ────────────────────────────

interface ActionButtonProps {
  item: RoadmapItem;
  businessId: string;
  onStateChange: () => void;
}

function ActionButton({ item, businessId, onStateChange }: ActionButtonProps) {
  const currentAction = getAction(businessId, item.id);
  const done = isDone(businessId, item.id);

  if (done) return null;

  let label: string | null = null;
  let value: "in_progress" | "started" = "in_progress";

  if (item.phase === "refinement") {
    label = "Подготовить";
    value = "in_progress";
  } else if (item.phase === "execution") {
    if (item.autonomy === "A2") {
      label = "Сделать";
      value = "started";
    } else if (item.autonomy === "A3") {
      label = "Начать";
      value = "started";
    }
  }

  if (!label) return null;

  const isActive = currentAction === value;

  return (
    <button
      type="button"
      className={`rm-action-btn${isActive ? " rm-action-btn--done" : ""}`}
      onClick={() => {
        if (isActive) {
          localStorage.removeItem(lsActionKey(businessId, item.id));
        } else {
          localStorage.setItem(lsActionKey(businessId, item.id), value);
        }
        onStateChange();
      }}
    >
      {isActive ? "В работе" : label}
    </button>
  );
}

// ── Один пункт карты ──────────────────────────────────────────────────────────

interface RoadmapRowProps {
  item: RoadmapItem;
  active: boolean;
  businessId: string;
  onStateChange: () => void;
}

function RoadmapRow({ item, active, businessId, onStateChange }: RoadmapRowProps) {
  const done = isDone(businessId, item.id);

  return (
    <div
      className={[
        "rm-row",
        active ? "rm-row--active" : "",
        `rm-row--${item.priority}`,
        done ? "rm-row--done" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="rm-row-left">
        <span className={`rm-dot rm-dot--${item.priority}`} />
      </div>
      <div className="rm-row-body">
        <div className="rm-row-title">{item.title}</div>
        {item.description && (
          <div className="rm-row-desc">{item.description}</div>
        )}
        <div className="rm-row-action">{item.action}</div>
        <div className="rm-row-actions">
          <ActionButton item={item} businessId={businessId} onStateChange={onStateChange} />
          <label className="rm-checkbox-label">
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => {
                if (e.target.checked) {
                  localStorage.setItem(lsDoneKey(businessId, item.id), "true");
                } else {
                  localStorage.removeItem(lsDoneKey(businessId, item.id));
                }
                onStateChange();
              }}
            />
            Сделано
          </label>
        </div>
      </div>
      <div className="rm-row-right">
        <AutonomyBadge autonomy={item.autonomy} />
      </div>
    </div>
  );
}

// ── Фильтрация элементов по фазовому фильтру ──────────────────────────────────

function applyPhaseFilter(
  items: RoadmapItem[],
  filter: PhaseFilter,
  businessId: string,
): RoadmapItem[] {
  switch (filter) {
    case "all":
      return items;
    case "done":
      return items.filter((i) => isDone(businessId, i.id));
    case "current":
      return items.filter(
        (i) =>
          !isDone(businessId, i.id) &&
          (i.status === "pending" ||
            i.status === "in_progress" ||
            getAction(businessId, i.id) != null),
      );
    case "future":
      return items.filter(
        (i) => !isDone(businessId, i.id) && i.phase === "execution",
      );
    default:
      return items;
  }
}

// ── Русские названия разделов ─────────────────────────────────────────────────

const SECTION_RU: Record<string, string> = {
  mission: "Миссия", goals: "Цели", priorities: "Приоритеты", contents: "Содержание",
  product: "Ценностный продукт", markets: "Целевые рынки", marketing: "Маркетинговый план",
  resources: "Ключевые ресурсы", finance: "Финансовый анализ", forecast: "Прогноз продаж",
  payments: "Календарь платежей", pest: "Внешняя экономика", competitors: "Конкурентный анализ",
  advantages: "Конкурентные преимущества", structure: "Схема компании", team: "Кадры",
  risks: "Риски", roadmap: "Дорожная карта", kpi: "KPI и метрики", investment: "Инвестиции",
  conclusion: "Заключение", appendix: "Приложения",
  executive_summary: "Резюме проекта", finances: "Финансы", market_size: "Объём рынка",
  market_analysis: "Анализ рынка", target_audience: "Целевая аудитория",
  product_service: "Продукт / Услуга", competitive_analysis: "Конкурентный анализ",
  marketing_strategy: "Маркетинговая стратегия", financial_model: "Финансовая модель",
  investment_plan: "Инвестиционный план", legal_structure: "Правовая структура",
  grants_subsidies: "Гранты и субсидии", exit_strategy: "Стратегия выхода",
};

function sectionRu(id: string): string {
  return SECTION_RU[id] ?? id.replace(/_/g, " ");
}

// ── Пробелы плана с доработкой ────────────────────────────────────────────────

function GapsSection({ gaps, planId }: { gaps: Gap[]; planId: string }) {
  const { user } = useAuth();
  const [activeGap, setActiveGap] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = gaps.filter(g => !done.has(g.missingSection));
  if (visible.length === 0) return null;

  async function submit(gap: Gap) {
    const answer = answers[gap.missingSection] ?? "";
    if (!answer.trim()) return;
    setLoading(true); setError(null);
    try {
      const idToken = await user!.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/intake-refine`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, sectionId: gap.missingSection, answer: answer.trim() }),
      });
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      setDone(prev => new Set([...prev, gap.missingSection]));
      setActiveGap(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rm-phase">
      <h3 className="rm-phase-title">
        Пробелы плана
        <span className="rm-phase-count">{visible.length}</span>
      </h3>
      <div className="rm-rows">
        {visible.map(g => (
          <div key={g.missingSection} className="rm-row">
            <div className="rm-row-left"><span className="rm-dot rm-dot--medium" /></div>
            <div className="rm-row-body">
              <div className="rm-row-title">{sectionRu(g.missingSection)}</div>
              {g.description && <div className="rm-row-desc">{g.description}</div>}
              {activeGap === g.missingSection ? (
                <>
                  <textarea
                    className="ia-refine-textarea"
                    rows={3}
                    placeholder="Опишите этот раздел…"
                    value={answers[g.missingSection] ?? ""}
                    onChange={e => setAnswers(prev => ({ ...prev, [g.missingSection]: e.target.value }))}
                    disabled={loading}
                    style={{ marginTop: 8, width: "100%", fontSize: 13 }}
                  />
                  {error && <p style={{ fontSize: 12, color: "#8B1A1A", margin: "4px 0" }}>{error}</p>}
                  <div className="rm-row-actions" style={{ marginTop: 6 }}>
                    <button type="button" className="rm-action-btn" onClick={() => void submit(g)} disabled={loading || !(answers[g.missingSection] ?? "").trim()}>
                      {loading ? "Сохраняем…" : "Отправить"}
                    </button>
                    <button type="button" className="rm-action-btn" onClick={() => setActiveGap(null)}>Отмена</button>
                  </div>
                </>
              ) : (
                <div className="rm-row-actions">
                  <button type="button" className="rm-action-btn" onClick={() => setActiveGap(g.missingSection)}>
                    Доработать
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Панель ────────────────────────────────────────────────────────────────────

interface Props {
  intake: PlanIntake | null | undefined;
  businessId: string;
  /** true если API-кредиты Claude пополнены (включает A3) */
  creditsAvailable?: boolean;
}

export function RoadmapPanel({ intake, businessId, creditsAvailable = false }: Props) {
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  // Счётчик для принудительного перерендера после изменений в localStorage
  const [tick, setTick] = useState(0);

  function handleStateChange() {
    setTick((t) => t + 1);
  }

  // tick используется для реактивного перерендера при изменении localStorage
  void tick;

  const roadmap: Roadmap | null = useMemo(() => {
    if (!intake) return null;
    return buildRoadmap({
      businessId,
      assessment: {
        concerns: intake.assessment.concerns,
        gaps: intake.assessment.gaps,
      },
      confidence: 0.86, // TODO: взять из intake.confidence когда поле появится
      milestones: [],   // milestones извлекаются Claude — пока пусто честно
      creditsAvailable,
    });
  }, [intake, businessId, creditsAvailable]);

  if (!roadmap) {
    return (
      <div className="rm-empty">
        <p className="rm-empty-title">Дорожная карта недоступна</p>
        <p className="rm-empty-sub">
          Загрузите бизнес-план и запустите оценку — карта появится автоматически.
        </p>
      </div>
    );
  }

  const refinement = roadmap.items
    .filter((i: RoadmapItem) => i.phase === "refinement")
    .sort((a: RoadmapItem, b: RoadmapItem) => PRIORITY_ORDER[a.priority]! - PRIORITY_ORDER[b.priority]!);

  const execution = roadmap.items.filter((i: RoadmapItem) => i.phase === "execution");
  const firstPending = refinement.find((i: RoadmapItem) => i.status === "pending") ?? refinement[0];

  // Применяем фильтр
  const filteredRefinement = applyPhaseFilter(refinement, phaseFilter, businessId);
  const filteredExecution = applyPhaseFilter(execution, phaseFilter, businessId);

  // Скрываем фазу если она полностью пуста после фильтрации (кроме "все")
  const showRefinement = filteredRefinement.length > 0 || phaseFilter === "all";
  const showExecution = filteredExecution.length > 0 || phaseFilter === "all";

  function cycleFilter() {
    setPhaseFilter((current) => {
      const idx = PHASE_CYCLE.indexOf(current);
      return PHASE_CYCLE[(idx + 1) % PHASE_CYCLE.length]!;
    });
  }

  return (
    <div className="rm-panel">
      {/* Текущий шаг — крупно */}
      {firstPending && phaseFilter === "all" && (
        <div className="rm-current-step">
          <span className="rm-current-label">Сейчас</span>
          <span className="rm-current-title">{firstPending.title}</span>
          <AutonomyBadge autonomy={firstPending.autonomy} />
        </div>
      )}

      {/* Фильтр по этапам */}
      <div className="rm-phase-filter">
        {PHASE_CYCLE.map((f) => (
          <button
            key={f}
            type="button"
            className={`rm-phase-filter-btn${phaseFilter === f ? " rm-phase-filter-btn--active" : ""}`}
            onClick={() => setPhaseFilter(f)}
          >
            {PHASE_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Фаза ДОРАБОТКА */}
      {showRefinement && (
        <section className="rm-phase">
          <h3 className="rm-phase-title">
            Доработка плана
            <span className="rm-phase-count">{filteredRefinement.length}</span>
          </h3>
          {filteredRefinement.length > 0 ? (
            <div className="rm-rows">
              {filteredRefinement.map((item: RoadmapItem) => (
                <RoadmapRow
                  key={item.id}
                  item={item}
                  active={item.id === firstPending?.id}
                  businessId={businessId}
                  onStateChange={handleStateChange}
                />
              ))}
            </div>
          ) : (
            <p className="rm-exec-empty">Нет элементов в этой категории</p>
          )}
        </section>
      )}

      {/* Фаза РЕАЛИЗАЦИЯ */}
      {showExecution && (
        <section className="rm-phase">
          <h3 className="rm-phase-title">
            Реализация
            {filteredExecution.length > 0 && (
              <span className="rm-phase-count">{filteredExecution.length}</span>
            )}
          </h3>
          {filteredExecution.length > 0 ? (
            <div className="rm-rows">
              {filteredExecution.map((item: RoadmapItem) => (
                <RoadmapRow
                  key={item.id}
                  item={item}
                  active={false}
                  businessId={businessId}
                  onStateChange={handleStateChange}
                />
              ))}
            </div>
          ) : (
            <p className="rm-exec-empty">{roadmap.executionEmptyReason}</p>
          )}
        </section>
      )}

    </div>
  );
}
