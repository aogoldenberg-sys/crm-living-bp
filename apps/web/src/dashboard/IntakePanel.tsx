import type { PlanIntake, AssumptionEntry } from "./useIntake";
import { useNavigate } from "react-router-dom";

interface Props {
  intake: PlanIntake | null | undefined;
}

// Русские названия разделов бизнес-плана (для пробелов).
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

// Человекочитаемые названия гипотез на русском.
// Если key есть в Firestore но не в этом маппинге — показываем key как есть.
const ASSUMPTION_LABELS: Record<string, string> = {
  adr_blended: "Средняя цена/ночь (смешанная)",
  adr_peak: "Цена/ночь в пиковый сезон",
  bep_occupancy: "Загрузка для безубыточности",
  cac: "Стоимость привлечения клиента",
  capex_total: "Капвложения (итого)",
  ebitda_margin_base: "Маржа EBITDA (базовый сценарий)",
  ebitda_year2_base: "EBITDA год 2 (базовый сценарий)",
  grant_agrostartup: "Грант АгроСтартап",
  grant_minek: "Грант Минэка",
  grant_minvostok: "Грант Минвостокразвития",
  modules_count: "Количество модулей",
  occupancy_annual: "Загрузка среднегодовая",
  occupancy_peak: "Загрузка в пиковый сезон",
  occupancy_shoulder: "Загрузка в межсезонье",
  occupancy_winter: "Загрузка зимой",
  payback_months: "Срок окупаемости",
  revenue_year1: "Выручка год 1",
  revenue_year2_base: "Выручка год 2 (базовый сценарий)",
  trip_check: "Средний чек поездки",
};

function assumptionLabel(key: string): string {
  return ASSUMPTION_LABELS[key] ?? key;
}

function formatAssumptionValue(entry: AssumptionEntry): string {
  const { value, unit } = entry;
  const isKopecks = unit === "kopecks" || unit === "₽";

  const fmt = (n: number) => {
    if (isKopecks) {
      // kopecks → рубли с разделителем тысяч
      return (n / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
    }
    return n.toLocaleString("ru-RU") + (unit ? ` ${unit}` : "");
  };

  if (value.point !== undefined) return fmt(value.point);
  if (value.lo !== undefined && value.hi !== undefined) {
    return `${fmt(value.lo)} – ${fmt(value.hi)}`;
  }
  return "—";
}

export function IntakePanel({ intake }: Props) {
  if (intake === undefined) {
    return (
      <div className="panel">
        <p className="panel-title">Оценка бизнес-плана</p>
        <p className="loading">Загрузка...</p>
      </div>
    );
  }
  if (intake === null) {
    return (
      <div className="panel">
        <p className="panel-title">Оценка бизнес-плана</p>
        <p className="loading">Оценка не найдена</p>
      </div>
    );
  }

  const navigate = useNavigate();
  const { assessment, disclaimer, narrativeReady } = intake;
  const assumptions = Object.values(assessment.assumptionsExtracted ?? {});

  const REQUIRED_SECTIONS = ["executive_summary", "finances", "market_size", "team", "risks"];
  const coveredIds = new Set(intake.mappedSections.filter(s => s.present).map(s => s.sectionId));
  const gaps = REQUIRED_SECTIONS.filter(s => !coveredIds.has(s));

  return (
    <div className="panel" style={{ overflow: "auto", maxHeight: 480 }}>
      <p className="panel-title">Оценка бизнес-плана</p>

      {/* Disclaimer §20.4 — безусловно первым */}
      <p className="disclaimer">{disclaimer}</p>

      {/* Нарративный слой — если ещё не готов (TODO) */}
      {!narrativeReady && (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            margin: "4px 0 12px",
            fontStyle: "italic",
          }}
        >
          Качественный разбор готовится (ждёт API-кредитов)
        </p>
      )}

      {/* Strengths */}
      {assessment.strengths.length > 0 && (
        <div className="intake-section">
          <p className="intake-section-title">Сильные стороны</p>
          <div className="chip-list">
            {assessment.strengths.map((s, i) => (
              <span key={i} className="chip chip-green">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Concerns */}
      {assessment.concerns.length > 0 && (
        <div className="intake-section">
          <p className="intake-section-title">Риски</p>
          <div className="chip-list">
            {assessment.concerns.map((c, i) => (
              <span
                key={i}
                className={`chip ${c.severity === "red" ? "chip-red" : "chip-yellow"}`}
                title={c.rationale ?? undefined}
              >
                {c.description}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gaps */}
      {assessment.gaps.length > 0 && (
        <div className="intake-section">
          <p className="intake-section-title">Пробелы в плане</p>
          <ul style={{ paddingLeft: 16, color: "var(--gray)", fontSize: 13 }}>
            {assessment.gaps.map((g, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{sectionLabel(g.missingSection)}</span>
                {g.description && (
                  <span style={{ color: "var(--text-muted)" }}> — {g.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gaps CTA — обязательные разделы, не найденные в документе */}
      {gaps.length > 0 && (
        <div className="intake-section">
          <p className="intake-section-title">Недостающие разделы</p>
          {gaps.map(gap => (
            <div key={gap} className="gap-cta" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "var(--gray)" }}>
                Раздел «{sectionLabel(gap)}» не найден.
              </span>
              <button
                type="button"
                onClick={() => void navigate("/onboarding/questionnaire")}
                style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
              >
                Дописать через вопросы?
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Assumptions table */}
      {assumptions.length > 0 && (
        <div className="intake-section">
          <p className="intake-section-title">Извлечённые гипотезы</p>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Параметр
                </th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>
                  Значение
                </th>
              </tr>
            </thead>
            <tbody>
              {assumptions.map((a, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.02)",
                  }}
                >
                  <td
                    style={{
                      padding: "3px 8px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                    }}
                  >
                    {assumptionLabel(a.key)}
                  </td>
                  <td
                    style={{
                      padding: "3px 8px",
                      textAlign: "right",
                      fontWeight: 500,
                    }}
                  >
                    {formatAssumptionValue(a)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
