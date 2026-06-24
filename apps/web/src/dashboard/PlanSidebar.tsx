/**
 * PlanSidebar — коллапсируемая панель 22 разделов бизнес-плана.
 *
 * Показывает статус каждого раздела на основе intake.assessment.
 * Клик по разделу раскрывает детали из gaps/concerns/strengths.
 */

import { useState } from "react";
import type { PlanIntake } from "./useIntake";

// ── 22 раздела бизнес-плана ───────────────────────────────────────────────────

interface PlanSection {
  id: string;
  title: string;
  /** Ключевые слова для поиска в strengths/gaps/concerns */
  keywords: string[];
}

const PLAN_SECTIONS: PlanSection[] = [
  { id: "summary",     title: "Резюме проекта",           keywords: ["резюм", "summary", "overview"] },
  { id: "company",     title: "Описание компании",         keywords: ["компани", "company", "организ"] },
  { id: "market",      title: "Анализ рынка",              keywords: ["рынок", "market", "анализ рын"] },
  { id: "product",     title: "Продукт / услуга",          keywords: ["продукт", "product", "услуга", "service"] },
  { id: "marketing",   title: "Маркетинговая стратегия",   keywords: ["маркетинг", "marketing", "стратег"] },
  { id: "sales",       title: "Каналы продаж",             keywords: ["продаж", "sales", "канал"] },
  { id: "pricing",     title: "Ценовая политика",          keywords: ["цен", "pricing", "price", "прайс"] },
  { id: "audience",    title: "Целевая аудитория",         keywords: ["аудитор", "audience", "клиент", "customer"] },
  { id: "competition", title: "Конкурентный анализ",       keywords: ["конкурент", "competition", "competitor"] },
  { id: "operations",  title: "Операционный план",         keywords: ["операцион", "operations", "процес"] },
  { id: "production",  title: "Производственный план",     keywords: ["производств", "production", "manufactur"] },
  { id: "technology",  title: "Технологии и ИТ",           keywords: ["технолог", "technology", "it", "ит", "цифр"] },
  { id: "hr",          title: "Кадровый план",             keywords: ["кадр", "hr", "персонал", "сотрудник", "staff"] },
  { id: "org",         title: "Организационная структура", keywords: ["организацион", "структур", "org", "управлен"] },
  { id: "legal",       title: "Юридическая структура",     keywords: ["юридич", "legal", "право", "регистр"] },
  { id: "finance",     title: "Финансовый план",           keywords: ["финанс", "finance", "бюджет", "budget"] },
  { id: "investment",  title: "Инвестиционный план",       keywords: ["инвест", "investment", "вложен"] },
  { id: "risks",       title: "Риски и меры",              keywords: ["риск", "risk", "угроз", "threat"] },
  { id: "swot",        title: "SWOT-анализ",               keywords: ["swot", "swot-анализ", "сильн", "слаб"] },
  { id: "partners",    title: "Партнёры и поставщики",     keywords: ["партнёр", "partner", "поставщик", "supplier"] },
  { id: "social",      title: "Социальная ответственность",keywords: ["социальн", "social", "csr", "ответственн"] },
  { id: "exit",        title: "Стратегия выхода",          keywords: ["выход", "exit", "стратег выход"] },
];

// ── Определение статуса раздела ───────────────────────────────────────────────

interface SectionStatus {
  hasData: boolean;
  /** Тексты из gaps/concerns/strengths, которые упоминают этот раздел */
  excerpts: string[];
}

function getSectionStatus(section: PlanSection, intake: PlanIntake | null | undefined): SectionStatus {
  if (!intake) return { hasData: false, excerpts: [] };

  const kws = section.keywords;
  const excerpts: string[] = [];

  // Strengths
  for (const s of intake.assessment.strengths) {
    const lower = s.toLowerCase();
    if (kws.some((kw) => lower.includes(kw))) {
      excerpts.push(s);
    }
  }

  // Concerns
  for (const c of intake.assessment.concerns) {
    const lower = c.description.toLowerCase();
    if (kws.some((kw) => lower.includes(kw))) {
      excerpts.push(c.description);
    }
  }

  // Gaps
  for (const g of intake.assessment.gaps) {
    const lower = (g.missingSection + " " + (g.description ?? "")).toLowerCase();
    if (kws.some((kw) => lower.includes(kw))) {
      excerpts.push(g.description ?? g.missingSection);
    }
  }

  return {
    hasData: excerpts.length > 0,
    excerpts,
  };
}

// ── Компонент строки раздела ──────────────────────────────────────────────────

interface SectionRowProps {
  section: PlanSection;
  intake: PlanIntake | null | undefined;
}

function SectionRow({ section, intake }: SectionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const status = getSectionStatus(section, intake);

  return (
    <>
      <div
        className={`plan-section-row${expanded ? " plan-section-row--expanded" : ""}`}
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <span className="plan-section-title">{section.title}</span>
        <span
          className={`plan-section-badge ${status.hasData ? "plan-section-badge--has" : "plan-section-badge--no"}`}
        >
          {status.hasData ? "есть" : "нет данных"}
        </span>
      </div>
      {expanded && (
        <div className="plan-section-detail">
          {status.excerpts.length > 0 ? (
            status.excerpts.map((ex, i) => (
              <p key={i} style={{ margin: "0 0 6px" }}>
                {ex}
              </p>
            ))
          ) : (
            <p style={{ margin: 0 }}>Раздел не охвачён в плане</p>
          )}
        </div>
      )}
    </>
  );
}

// ── Основной компонент ────────────────────────────────────────────────────────

interface PlanSidebarProps {
  intake: PlanIntake | null | undefined;
  isOpen: boolean;
}

export function PlanSidebar({ intake, isOpen }: PlanSidebarProps) {
  if (!isOpen) return null;

  return (
    <aside className="plan-sidebar-overlay" aria-label="Разделы бизнес-плана">
      <p className="plan-sidebar-overlay-title">Разделы бизнес-плана</p>
      {PLAN_SECTIONS.map((section) => (
        <SectionRow key={section.id} section={section} intake={intake} />
      ))}
    </aside>
  );
}

// ── Кнопка-переключатель для сайдбара ─────────────────────────────────────────

interface PlanSidebarToggleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function PlanSidebarToggle({ isOpen, onToggle }: PlanSidebarToggleProps) {
  return (
    <button
      type="button"
      className={`plan-sidebar-toggle${isOpen ? " plan-sidebar-toggle--open" : ""}`}
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label="Разделы бизнес-плана"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor" opacity="0.7"/>
        <rect x="2" y="7.25" width="8" height="1.5" rx="0.75" fill="currentColor" opacity="0.7"/>
        <rect x="2" y="11.5" width="10" height="1.5" rx="0.75" fill="currentColor" opacity="0.7"/>
      </svg>
      Разделы
    </button>
  );
}
