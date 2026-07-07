import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useIntake } from "../../dashboard/useIntake";
import { useBusinessEvents } from "../reporting/useBusinessEvents";
import { computeHealthCheck } from "@crm/core";
import { PulseWidget } from "./PulseWidget";
import { RevisionOnboarding } from "./RevisionOnboarding";
import "./BusinessPage.css";

const SECTIONS = [
  { id: "mission",     title: "Миссия",                    icon: "🎯" },
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
  { id: "team",        title: "Команда",                   icon: "👥" },
  { id: "risks",       title: "Риски",                     icon: "⚠️" },
  { id: "roadmap",     title: "Дорожная карта",            icon: "🗺️" },
  { id: "kpi",         title: "KPI и метрики",             icon: "📏" },
  { id: "investment",  title: "Инвестиции",                icon: "💳" },
  { id: "conclusion",  title: "Заключение",                icon: "✅" },
  { id: "appendix",    title: "Приложения",                icon: "📎" },
];

const SECTION_TO_INTAKE_ID: Record<string, string> = {
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

export function BusinessPage() {
  const { businessId } = useAuth();
  const navigate = useNavigate();
  const { data: intake } = useIntake(businessId ?? "");
  const { data: events = [] } = useBusinessEvents(businessId ?? "");
  const [showOnboarding, setShowOnboarding] = useState(!businessId);

  const mappedSections = intake?.mappedSections ?? [];

  const filledCount = SECTIONS.filter(s => {
    const intakeId = SECTION_TO_INTAKE_ID[s.id];
    return intakeId && mappedSections.find(m => m.sectionId === intakeId && m.present);
  }).length;
  const completeness = filledCount / SECTIONS.length;

  const balance = events
    .filter(e => e.type === "payment_in" || e.type === "payment_out")
    .reduce((s, e) => s + (e.type === "payment_in" ? e.amount : -e.amount), 0);
  const hc = computeHealthCheck(events, balance);

  if (showOnboarding) {
    return <RevisionOnboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="business-page">
      <PulseWidget hc={hc} events={events} onSectionClick={(id) => navigate(`/dashboard/plan/${id}`)} />

      {completeness >= 0.6 && (
        <div className="bp-build-cta">
          <p>Достаточно данных для формирования плана</p>
          <button className="bp-btn-primary" onClick={() => navigate("/dashboard")}>
            Собрать план v1 →
          </button>
        </div>
      )}

      <div className="bp-sections">
        {SECTIONS.map(section => {
          const intakeId = SECTION_TO_INTAKE_ID[section.id];
          const hasData = intakeId
            ? Boolean(mappedSections.find(m => m.sectionId === intakeId && m.present))
            : false;
          return (
            <div
              key={section.id}
              className={`bp-section-card ${hasData ? "bp-section-card--live" : "bp-section-card--empty"}`}
              onClick={() => navigate(`/dashboard/plan/${section.id}`)}
            >
              <span className="bp-section-icon">{section.icon}</span>
              <span className="bp-section-title">{section.title}</span>
              {hasData
                ? <span className="bp-section-dot bp-section-dot--gold" />
                : <span className="bp-section-cta">Оживить: загрузите выписку</span>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}
