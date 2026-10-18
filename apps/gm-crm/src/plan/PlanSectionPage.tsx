import { useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useIntake } from "../dashboard/useIntake";
import { deriveGaps } from "@crm/core";
import type { DocMappedSection } from "@crm/schemas";
import { BOOK_SECTION_ALIAS } from "@crm/schemas";
import { GrantView } from "../components/GrantView";
import { UploadPlanButton } from "../dashboard/UploadPlanButton";
import "./PlanSectionPage.css";

export const SECTIONS = [
  { id: "mission",     title: "Стратегия",                  icon: "🎯" },
  { id: "goals",       title: "Цели",                      icon: "📈" },
  { id: "priorities",  title: "Приоритеты",                icon: "🔢" },
  { id: "contents",    title: "Содержание",                icon: "📋" },
  { id: "product",     title: "Ценностный продукт",        icon: "💎" },
  { id: "markets",     title: "Целевые рынки",             icon: "🌍" },
  { id: "marketing",   title: "Маркетинговый план",        icon: "📣" },
  { id: "resources",   title: "Ключевые ресурсы",          icon: "⚙️" },
  { id: "finance",     title: "Финансовый анализ",         icon: "💰" },
  { id: "forecast",    title: "Прогноз продаж",            icon: "📊" },
  { id: "payments",    title: "Календарь платежей",        icon: "📅" },
  { id: "pest",        title: "Внешняя экономика",         icon: "🌐" },
  { id: "competitors", title: "Конкурентный анализ",       icon: "⚔️" },
  { id: "advantages",  title: "Конкурентные преимущества", icon: "🏆" },
  { id: "structure",   title: "Схема компании",            icon: "🏢" },
  { id: "team",        title: "Кадры",                     icon: "👥" },
  { id: "risks",       title: "Риски",                     icon: "⚠️" },
  { id: "roadmap",     title: "Дорожная карта",            icon: "🗺️" },
  { id: "kpi",         title: "KPI и метрики",             icon: "📏" },
  { id: "investment",  title: "Инвестиции",                icon: "💳" },
  { id: "conclusion",  title: "Заключение",                icon: "✅" },
  { id: "appendix",    title: "Приложения",                icon: "📎" },
];

const CHART_SECTIONS = new Set(["finance", "forecast", "payments"]);

/**
 * Маппинг UI-идентификаторов разделов (PlanSectionPage) →
 * идентификаторов секций из intake экстрактора (REQUIRED_SECTIONS в core).
 *
 * БЛОКЕР 4: без этой таблицы mappedSections.find() всегда возвращает null,
 * потому что экстрактор использует другие ключи (executive_summary, finances…).
 */
export const SECTION_TO_INTAKE_ID: Record<string, string> = {
  mission:     "executive_summary",
  goals:       "executive_summary",
  priorities:  "executive_summary",
  contents:    "executive_summary",
  product:     "solution",
  markets:     "market_size",
  marketing:   "marketing_strategy",
  resources:   "operations",
  finance:     "finances",
  forecast:    "finances",
  payments:    "finances",
  pest:        "risks",
  competitors: "competitors",
  advantages:  "value_proposition",
  structure:   "team",
  team:        "team",
  risks:       "risks",
  roadmap:     "product_roadmap",
  kpi:         "kpi_metrics",
  investment:  "funding_ask",
  conclusion:  "exit_strategy",
  appendix:    "exit_strategy",
};

// Bar chart высотой 7 точек из contentSummary (берём длины слов как прокси-данные)
function deriveBarHeights(summary: string): number[] {
  const words = summary.trim().split(/\s+/).slice(0, 7);
  if (words.length < 3) return [30, 45, 38, 60, 50, 42, 55];
  const heights: number[] = [];
  for (let i = 0; i < 7; i++) {
    const w = words[i % words.length] ?? "";
    heights.push(30 + (w.length * 5) % 60);
  }
  return heights;
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = pct >= 70 ? "psp-badge--green" : pct >= 40 ? "psp-badge--yellow" : "psp-badge--red";
  return <span className={`psp-badge ${cls}`}>Уверенность {pct}%</span>;
}

function BarChart({ heights }: { heights: number[] }) {
  return (
    <div className="psp-chart">
      {heights.map((h, i) => (
        <div
          key={i}
          className="psp-bar"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

export function PlanSectionPage({ mode }: { mode?: "revision" } = {}) {
  const { sectionId } = useParams<{ sectionId: string }>();
  const navigate = useNavigate();
  const { businessId } = useAuth();
  const { data: intake, isLoading } = useIntake(businessId ?? "demo");
  const [expanded, setExpanded] = useState(false);
  const [showGrant, setShowGrant] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const basePath = mode === "revision" ? "/business" : "/dashboard";

  const idx = SECTIONS.findIndex(s => s.id === sectionId);
  const section = idx >= 0 ? SECTIONS[idx] : null;

  // Ищем раздел: сначала по прямому book-ID, затем по алиасу (goals → mission и т.п.)
  const aliasId = BOOK_SECTION_ALIAS[sectionId ?? ""];
  const mapped = intake?.mappedSections.find(s => s.sectionId === sectionId)
    ?? (aliasId ? intake?.mappedSections.find(s => s.sectionId === aliasId) : undefined)
    ?? null;

  const coveredSections = useMemo((): DocMappedSection[] =>
    (intake?.mappedSections ?? [])
      .filter(m => m.present)
      .map(m => ({ sectionId: m.sectionId, pageRange: [0, 0] as [number, number], confidence: m.confidence })),
    [intake],
  );
  const gapForSection = useMemo(() => {
    if (mode !== "revision") return null;
    return deriveGaps(coveredSections).find(g => g.sectionId === sectionId || g.sectionId === aliasId) ?? null;
  }, [mode, coveredSections, sectionId, aliasId]);

  // Диагностика: если данные пришли но раздел не найден — логируем
  if (intake && !mapped && sectionId) {
    console.debug(
      `[PlanSection] sectionId="${sectionId}" alias="${aliasId ?? "-"}" — не найден. ` +
      `Доступные секции: ${intake.mappedSections.filter(s => s.present).map(s => s.sectionId).join(", ")}`,
    );
  }

  const prevSection = idx > 0 ? SECTIONS[idx - 1] : null;
  const nextSection = idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;

  if (isLoading) {
    return (
      <div className="psp-page">
        <div className="psp-skeleton" />
        <div className="psp-skeleton psp-skeleton--wide" />
        <div className="psp-skeleton" />
      </div>
    );
  }

  // Нет документа — показываем CTA загрузки вместо пустой страницы
  if (!intake) {
    return (
      <div className="psp-page">
        <div className="psp-breadcrumb">
          <button className="psp-back-btn" onClick={() => navigate(basePath)}>
            ← Назад к плану
          </button>
        </div>
        <div className="psp-empty-state">
          <span className="psp-empty-icon">📄</span>
          <h2 className="psp-empty-title">Загрузите бизнес-план</h2>
          <p className="psp-empty-text">
            Чтобы увидеть содержимое раздела, загрузите ваш бизнес-план.<br />
            Поддерживаются PDF, Word, Excel, TXT.
          </p>
          <UploadPlanButton ref={uploadRef} />
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="psp-page">
        <p className="psp-not-found">Раздел не найден</p>
      </div>
    );
  }

  const showChart = CHART_SECTIONS.has(section.id) && mapped?.present;
  const barHeights = showChart ? deriveBarHeights(mapped!.contentSummary) : [];

  if (showGrant && intake) {
    return (
      <div className="psp-page">
        <div className="psp-breadcrumb">
          <button className="psp-back-btn" onClick={() => setShowGrant(false)}>
            ← Назад к разделу
          </button>
        </div>
        <GrantView intake={intake} planId={intake.intakeId ?? businessId ?? "demo"} />
      </div>
    );
  }

  return (
    <div className="psp-page">
      {/* Хлебные крошки */}
      <div className="psp-breadcrumb">
        <button className="psp-back-btn" onClick={() => navigate(basePath)}>
          ← Назад к плану
        </button>
        <span className="psp-section-counter">
          Раздел {idx + 1} из {SECTIONS.length}
        </span>
        <div className="psp-nav-inline">
          {prevSection && (
            <button
              className="psp-nav-btn"
              onClick={() => navigate(`${basePath}/plan/${prevSection.id}`)}
            >
              ← {prevSection.title}
            </button>
          )}
          {nextSection && (
            <button
              className="psp-nav-btn"
              onClick={() => navigate(`${basePath}/plan/${nextSection.id}`)}
            >
              {nextSection.title} →
            </button>
          )}
        </div>
        <div className="psp-action-btns">
          <button
            className="psp-nav-btn psp-btn--print"
            onClick={() => window.print()}
            title="Распечатать бизнес-план"
          >
            🖨️ Печать
          </button>
          {intake && (
            <button
              className="psp-nav-btn psp-btn--grant"
              onClick={() => setShowGrant(true)}
              title="Версия для субсидий и грантов"
            >
              📋 Для субсидий и грантов
            </button>
          )}
        </div>
      </div>

      {/* Заголовок */}
      <div className="psp-header">
        <span className="psp-icon">{section.icon}</span>
        <h1 className="psp-title">{section.title}</h1>
        {mapped && <ConfidenceBadge value={mapped.confidence} />}
        {!mapped && <span className="psp-badge psp-badge--red">Уверенность 0%</span>}
      </div>

      {/* Метрики-карточки */}
      <div className="psp-metrics">
        {mapped?.present ? (
          <>
            <div className="psp-metric-card">
              <span className="psp-metric-label">Статус</span>
              <span className="psp-metric-val">Найден</span>
            </div>
            <div className="psp-metric-card">
              <span className="psp-metric-label">Уверенность</span>
              <span className="psp-metric-val">{Math.round(mapped.confidence * 100)}%</span>
            </div>
            <div className="psp-metric-card">
              <span className="psp-metric-label">Объём</span>
              <span className="psp-metric-val">{mapped.contentSummary.split(/\s+/).length} слов</span>
            </div>
          </>
        ) : (
          <div className="psp-metric-card psp-metric-card--empty">
            <span className="psp-metric-label">Данные не загружены</span>
            <span className="psp-metric-val">—</span>
          </div>
        )}
      </div>

      {/* График (только для финансовых разделов) */}
      {showChart && <BarChart heights={barHeights} />}

      {/* Текст раздела */}
      <div className="psp-content-block">
        <div className={`psp-content-text${expanded ? " psp-content-text--expanded" : ""}`}>
          {mapped
            ? mapped.contentSummary
            : "Раздел не найден в документе"}
        </div>
        {mapped && mapped.contentSummary.split(/\s+/).length > 30 && (
          <button
            className="psp-expand-btn"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? "Скрыть" : "Показать полностью"}
          </button>
        )}
        {!mapped && mode === "revision" && gapForSection && (
          <div className="psp-revision-cta">
            <p className="psp-revision-cta-label">
              {gapForSection.canInfer ? "Будет выведено из данных" : "Нужен документ"}
            </p>
            <p className="psp-revision-cta-text">{gapForSection.whereToGet}</p>
            <button className="psp-nav-btn" onClick={() => navigate("/business")}>
              Загрузить документ →
            </button>
          </div>
        )}
      </div>

      {/* Нижняя навигация */}
      <div className="psp-footer-nav">
        {prevSection ? (
          <button
            className="psp-nav-btn psp-nav-btn--large"
            onClick={() => navigate(`${basePath}/plan/${prevSection.id}`)}
          >
            ← {prevSection.title}
          </button>
        ) : <div />}
        {nextSection && (
          <button
            className="psp-nav-btn psp-nav-btn--large"
            onClick={() => navigate(`${basePath}/plan/${nextSection.id}`)}
          >
            {nextSection.title} →
          </button>
        )}
      </div>
    </div>
  );
}
