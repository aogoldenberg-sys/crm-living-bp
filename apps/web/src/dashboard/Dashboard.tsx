import { useAuth } from "../auth/useAuth";
import { useRole } from "../auth/useRole";
import { useFunnelMetrics } from "./useFunnelMetrics";
import { useDemandSignals } from "./useDemandSignals";
import { usePipeline } from "../funnel/usePipeline";
import { useIntake } from "./useIntake";
import { PipelinePanel } from "../funnel/PipelinePanel";
import { KpiCard } from "./KpiCard";
import { StageChart } from "./StageChart";
import { RoadmapPanel } from "./RoadmapPanel";
import "./Dashboard.css";

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

// ── Sidebar icons (минималистичные SVG) ───────────────────────────────────────

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 6.5L8 2l6 4.5V14H10v-3H6v3H2V6.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}
function IconPipeline() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="3" height="10" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="6.5" y="6" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="11" y="8" width="3" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}
function IconFinance() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 12h12M4 12V7m3 5V5m3 7V9m3 3V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}
function IconAssess() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <line x1="3" y1="8" x2="25" y2="20" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

// ── DemandPanel ───────────────────────────────────────────────────────────────

interface DemandPanelProps {
  leads: number;
  qualifiedRate: number;
  trendScore: number;
}

function DemandPanel({ leads, qualifiedRate, trendScore }: DemandPanelProps) {
  const trendLabel =
    trendScore > 0.1 ? "▲ рост" : trendScore < -0.1 ? "▼ падение" : "→ нейтрально";
  return (
    <div className="db-right-card">
      <p className="db-right-card-title">Сигналы спроса</p>
      <div className="db-right-nums">
        <div className="db-right-num-block">
          <span className="db-right-big">{leads}</span>
          <span className="db-right-sub">лидов</span>
        </div>
        <div className="db-right-num-sep" />
        <div className="db-right-num-block">
          <span className="db-right-big">{Math.round(qualifiedRate * 100)}%</span>
          <span className="db-right-sub">квалиф.</span>
        </div>
        <div className="db-right-num-sep" />
        <div className="db-right-num-block">
          <span className="db-right-big">{trendLabel}</span>
          <span className="db-right-sub">тренд</span>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { businessId, logout, role } = useAuth();
  const bid = businessId ?? "demo";

  // Роль с полными правами (entityAccess + dashboardWidgets)
  const { roleRecord } = useRole(bid);
  const { entityAccess, dashboardWidgets } = roleRecord;

  const { stages, totalDeals: funnelTotalDeals } = useFunnelMetrics(bid);
  const { signals } = useDemandSignals(bid);
  const { data: pipeline } = usePipeline(bid);
  const { data: intake } = useIntake(bid);

  const isOwner = !role || role === "owner";

  // ── KPI derivations ──────────────────────────────────────────────────────
  const nonTerminal = stages.filter((s) => !s.terminal);
  const totalStuck = stages.reduce((n, s) => n + s.stuck.length, 0);
  const totalDeals = pipeline?.size ?? funnelTotalDeals;
  const pipelineWt = stages.reduce((sum, s) => sum + s.weightedPipeline, 0);
  const firstConv = nonTerminal[0]?.factConversion;
  const convStr = firstConv != null ? `${Math.round(firstConv * 100)}%` : "—";

  // Spark values for KPI cards (count per non-terminal stage)
  const stagesSpark = nonTerminal.map((s) => s.count);

  // Intake
  const strengthsCount = intake?.assessment.strengths.length ?? 0;
  const risksCount = intake?.assessment.concerns.length ?? 0;

  // Стадийная зависимость: есть ли реальные сделки
  const hasDeals = totalDeals > 0;

  // ── Role-based widget visibility ─────────────────────────────────────────
  const showDeals = entityAccess.deals !== "none" && dashboardWidgets.includes("pipeline");
  const showFinancials =
    entityAccess.financials !== "none" && dashboardWidgets.includes("cash_forecast");
  const showDemandSignals =
    signals !== null && dashboardWidgets.includes("demand_signals");

  // Bottom row: first 4 stages (mix terminal + non-terminal)
  const bottomStages = stages.slice(0, 4);
  const bottomColors = ["gold", "burgundy", "teal", "ivory"] as const;

  return (
    <div className="db-root">
      {/* ── Тёмный сайдбар 280px ──────────────────────────────────────────── */}
      <aside className="db-sidebar">
        <div className="db-sidebar-logo">
          <IconGlyph />
          <div className="db-sidebar-logo-text">
            <span className="db-logo-name">Живой</span>
            <span className="db-logo-sub">Бизнес-план</span>
          </div>
        </div>

        <nav className="db-sidebar-nav" aria-label="Разделы">
          <a href="#" className="db-nav-item db-nav-item--active">
            <IconHome /> Дашборд
          </a>
          {showDeals && (
            <a href="#pipeline" className="db-nav-item">
              <IconPipeline /> Воронка
            </a>
          )}
          {showFinancials && (
            <a href="#finances" className="db-nav-item">
              <IconFinance /> Финансы
            </a>
          )}
          {isOwner && (
            <a href="#intake" className="db-nav-item">
              <IconAssess /> Оценка
            </a>
          )}
        </nav>

        <footer className="db-sidebar-footer">
          <div className="db-sidebar-meta">
            <span className="db-sid-bid">{bid}</span>
            {role && (
              <span className="db-sid-role">
                {role === "manager" ? "Менеджер" : "Владелец"}
              </span>
            )}
          </div>
          <button className="db-sid-logout" onClick={() => void logout()}>
            Выйти
          </button>
        </footer>
      </aside>

      {/* ── Ivory-канвас ──────────────────────────────────────────────────── */}
      <div className="db-body" data-canvas="light">
        {/* Заголовок страницы */}
        <header className="db-page-header">
          <h1 className="db-page-title">Бизнес-план</h1>
          {role && (
            <span className="db-role-badge">
              {role === "manager" ? "Менеджер" : "Владелец"}
            </span>
          )}
        </header>

        {/* ── 4 KPI-карточки сверху ──────────────────────────────────────── */}
        <div className="db-kpi-row">
          <KpiCard
            color="caramel"
            title="Воронка"
            value={pipelineWt > 0 ? formatRub(pipelineWt) : "—"}
            sub={totalDeals ? `${totalDeals} сделок` : "нет сделок"}
            spark={stagesSpark.length ? stagesSpark : undefined}
          />
          <KpiCard
            color="burgundy"
            title="Застряли"
            value={String(totalStuck)}
            sub={totalDeals ? `из ${totalDeals} сделок` : "—"}
          />
          <KpiCard
            color="teal"
            title="Активных"
            value={String(nonTerminal.reduce((s, x) => s + x.count, 0))}
            sub={`${nonTerminal.length} этапов`}
          />
          <KpiCard
            color="ivory"
            title="Конверсия"
            value={convStr}
            sub="первый этап"
            detail={firstConv != null ? `норма ${Math.round((nonTerminal[0]?.normConversion ?? 0) * 100)}%` : undefined}
          />
        </div>

        {/* ── Центр + правая колонка ─────────────────────────────────────── */}
        <div className="db-mid-section">
          <section className="db-pipeline-section">
            {/* Воронка спит — нет сделок → свёрнута в одну строку */}
            {!hasDeals && (
              <div className="pipeline-sleep-row">
                <span className="pipeline-sleep-icon">○</span>
                Воронка активируется с первой сделкой
              </div>
            )}

            {/* Дорожная карта — центр когда нет сделок */}
            {!hasDeals && isOwner && (
              <RoadmapPanel
                intake={intake}
                businessId={bid}
              />
            )}

            {/* Воронка — центр когда есть сделки и роль разрешает */}
            {hasDeals && showDeals && (
              <div id="pipeline">
                <PipelinePanel filterMine={role === "manager"} />
              </div>
            )}
          </section>

          {/* Правая колонка */}
          <aside className="db-right-col">
            {/* Bar-chart по этапам */}
            <StageChart stages={stages} />

            {/* Сигналы спроса — только если есть данные и роль разрешает */}
            {showDemandSignals && signals !== null && (
              <DemandPanel
                leads={signals.leads}
                qualifiedRate={signals.qualifiedRate}
                trendScore={signals.trendScore}
              />
            )}

            {/* Вторичная метрика — Оценка */}
            {isOwner && (
              <div className="db-right-card" id="intake">
                <p className="db-right-card-title">Оценка плана</p>
                <div className="db-right-nums">
                  <div className="db-right-num-block">
                    <span className="db-right-big">{strengthsCount}</span>
                    <span className="db-right-sub">сильных</span>
                  </div>
                  <div className="db-right-num-sep" />
                  <div className="db-right-num-block">
                    <span className="db-right-big db-right-big--risk">{risksCount}</span>
                    <span className="db-right-sub">рисков</span>
                  </div>
                </div>
                {intake?.disclaimer && (
                  <p className="db-right-disclaimer">{intake.disclaimer}</p>
                )}
              </div>
            )}
          </aside>
        </div>

        {/* ── 4 карточки по этапам снизу (только при доступе к финансам) ── */}
        {showFinancials && bottomStages.length > 0 && (
          <div className="db-bottom-row" id="finances">
            {bottomStages.map((s, i) => (
              <KpiCard
                key={s.stageId}
                color={bottomColors[i % bottomColors.length]}
                title={s.stageName}
                value={formatRub(s.weightedPipeline)}
                sub={`${s.count} сд · ${Math.round(s.factConversion * 100)}%`}
                detail={s.stuck.length > 0 ? `${s.stuck.length} застр.` : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
