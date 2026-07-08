/**
 * GrantView — отображение бизнес-плана в формате для госсубсидий и грантов.
 *
 * Порядок разделов соответствует российским требованиям Минэкономразвития
 * и стандартным заявкам на гранты (ФРМ, Корпорация МСП, региональные фонды).
 *
 * Маппинг section ID из rule-mapper.ts:
 *   executive_summary → Резюме проекта
 *   product_roadmap   → Календарный план
 *   finances          → Смета / Бюджет
 *   kpi_metrics       → Показатели эффективности
 *   solution          → Социальный эффект (ближайший раздел по смыслу)
 *
 * Watermark removed when plan is marked 'approved' — TODO: wire to plan status field
 */

import type { PlanIntake, MappedSection } from "../dashboard/useIntake";
import type { Gap } from "../dashboard/useIntake";
import "./GrantView.css";

// ── Grant section config ──────────────────────────────────────────────────────

interface GrantSection {
  id: string;
  /** Intake section IDs from rule-mapper.ts that feed this grant section */
  intakeIds: string[];
  title: string;
  subtitle: string;
}

// РЕШЕНИЕ: берём ID прямо из SECTION_KEYWORDS в rule-mapper.ts — без хардкода произвольных ключей
const GRANT_SECTIONS: GrantSection[] = [
  {
    id: "summary",
    intakeIds: ["executive_summary"],
    title: "Резюме проекта",
    subtitle: "Краткое описание проекта, его целей и ожидаемых результатов",
  },
  {
    id: "timeline",
    intakeIds: ["product_roadmap"],
    title: "Календарный план",
    subtitle: "Этапы реализации проекта с указанием сроков и ответственных",
  },
  {
    id: "budget",
    intakeIds: ["finances"],
    title: "Смета / Бюджет",
    subtitle: "Детализированная смета расходов, источники финансирования",
  },
  {
    id: "kpi",
    intakeIds: ["kpi_metrics"],
    title: "Показатели эффективности",
    subtitle: "KPI проекта: количественные и качественные результаты",
  },
  {
    id: "impact",
    intakeIds: ["solution"],
    title: "Социальный эффект",
    subtitle: "Влияние проекта на занятость, регион, отрасль",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function findSection(
  mappedSections: MappedSection[],
  intakeIds: string[],
): MappedSection | null {
  for (const id of intakeIds) {
    const found = mappedSections.find(s => s.sectionId === id && s.present);
    if (found) return found;
  }
  return null;
}

function today(): string {
  return new Date().toLocaleDateString("ru-RU", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface PlaceholderProps {
  title: string;
  subtitle: string;
  grantSectionId: string;
  onRefine: (sectionId: string) => void;
}

function Placeholder({ title, subtitle, grantSectionId, onRefine }: PlaceholderProps) {
  return (
    <div className="gv-placeholder">
      <p className="gv-placeholder-title">{title}</p>
      <p className="gv-placeholder-sub">{subtitle}</p>
      <p className="gv-placeholder-hint">Требуется заполнить</p>
      <button
        type="button"
        className="gv-refine-btn"
        onClick={() => onRefine(grantSectionId)}
      >
        Заполнить через вопросы
      </button>
    </div>
  );
}

interface SectionBlockProps {
  gs: GrantSection;
  mapped: MappedSection | null;
  gap: Gap | undefined;
  onRefine: (sectionId: string) => void;
}

function SectionBlock({ gs, mapped, onRefine }: SectionBlockProps) {
  return (
    <section className="gv-section">
      <h2 className="gv-section-title">{gs.title}</h2>
      <p className="gv-section-sub">{gs.subtitle}</p>
      {mapped ? (
        <div className="gv-content">
          <p className="gv-confidence">
            Уверенность: {Math.round(mapped.confidence * 100)}%
          </p>
          <p className="gv-text">{mapped.contentSummary}</p>
        </div>
      ) : (
        <Placeholder
          title={gs.title}
          subtitle={gs.subtitle}
          grantSectionId={gs.intakeIds[0] ?? gs.id}
          onRefine={onRefine}
        />
      )}
    </section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  intake: PlanIntake;
  planId: string;
}

export function GrantView({ intake, planId: _planId }: Props) {
  const { mappedSections, assessment } = intake;

  // Для кнопки "Заполнить" — навигируем к диалогу из IntakeAssessment.
  // РЕШЕНИЕ: проще всего открыть в новой вкладке (или scroll к ia-panel).
  // TODO: wire to RefineDialog from IntakeAssessment when gap targeting is needed.
  function handleRefine(sectionId: string) {
    const el = document.querySelector<HTMLElement>(".ia-btn--refine");
    if (el) {
      el.click();
    } else {
      console.info("[GrantView] refinement requested for:", sectionId);
    }
  }

  return (
    // Watermark removed when plan is marked 'approved' — TODO: wire to plan status field
    <div className="grant-view">
      {/* ── Титульный лист ── */}
      <div className="gv-cover">
        <p className="gv-watermark-text">ПРОЕКТ</p>
        <p className="gv-org">ООО «ОпенТрейдГрупп»</p>
        <p className="gv-inn">ИНН 9703235411</p>
        <h1 className="gv-cover-title">Бизнес-план проекта</h1>
        <p className="gv-date">Дата: {today()}</p>
        {assessment.strengths.length > 0 && (
          <p className="gv-tagline">{assessment.strengths[0]}</p>
        )}
      </div>

      {/* ── Разделы плана ── */}
      <div className="gv-body">
        {GRANT_SECTIONS.map(gs => {
          const mapped = findSection(mappedSections, gs.intakeIds);
          const gap = assessment.gaps.find(g => gs.intakeIds.includes(g.missingSection));
          return (
            <SectionBlock
              key={gs.id}
              gs={gs}
              mapped={mapped}
              gap={gap}
              onRefine={handleRefine}
            />
          );
        })}
      </div>
    </div>
  );
}
