import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useIntake } from "../../dashboard/useIntake";
import { useBusinessEvents } from "../reporting/useBusinessEvents";
import { computeHealthCheck, deriveGaps } from "@crm/core";
import type { DocMappedSection, HealthCheck } from "@crm/schemas";
import { BOOK_SECTION_ALIAS } from "@crm/schemas";
import { SECTIONS } from "../../plan/PlanSectionPage";
import { PulseWidget } from "./PulseWidget";
import { UploadBusinessDocsButton } from "./UploadBusinessDocsButton";
import "../../dashboard/Dashboard.css";
import "../../plan/PlanSectionPage.css";
import "./BusinessPage.css";

type MappedSection = { sectionId: string; present: boolean; contentSummary: string; confidence: number };

// ── Section content panel ──────────────────────────────────────────────────
function BizSectionView({ sectionId, mappedSections, onBack }: {
  sectionId: string;
  mappedSections: MappedSection[];
  onBack: () => void;
}) {
  const sec = SECTIONS.find(s => s.id === sectionId);
  const aliasId = BOOK_SECTION_ALIAS[sectionId];
  const mapped = mappedSections.find(m => m.sectionId === sectionId)
    ?? (aliasId ? mappedSections.find(m => m.sectionId === aliasId) : undefined);
  const pct = mapped ? Math.round(mapped.confidence * 100) : 0;
  const cls = pct >= 70 ? "green" : pct >= 40 ? "yellow" : "red";
  return (
    <div className="biz-section-panel k-fadein">
      <button className="k-nav-btn biz-back-btn" onClick={onBack}>← Обзор</button>
      <div className="biz-section-header">
        <span className="biz-section-icon">{sec?.icon}</span>
        <h2 className="biz-section-title">{sec?.title}</h2>
        {mapped?.present && <span className={`psp-badge psp-badge--${cls}`}>Уверенность {pct}%</span>}
        {!mapped?.present && <span className="psp-badge psp-badge--red">Не найден</span>}
      </div>
      <div className="biz-section-content">
        {mapped?.present ? mapped.contentSummary : "Раздел не найден в загруженном документе"}
      </div>
    </div>
  );
}

// ── Analysis panel ─────────────────────────────────────────────────────────
function BizAnalysisView({ hc, gaps, intake, onBack }: {
  hc: HealthCheck;
  gaps: ReturnType<typeof deriveGaps>;
  intake: ReturnType<typeof useIntake>["data"];
  onBack: () => void;
}) {
  const [uploadKind, setUploadKind] = useState<string | null>(null);
  const burnRub = hc.burn_rate_kopecks != null ? Math.round(hc.burn_rate_kopecks / 100).toLocaleString("ru-RU") : null;
  return (
    <div className="biz-analysis-panel k-fadein">
      <button className="k-nav-btn biz-back-btn" onClick={onBack}>← Обзор</button>
      <h2 className="biz-analysis-title">Анализ бизнеса</h2>
      <div className="biz-metric-row">
        {[
          { label: "Запас наличных", val: hc.runway_days != null ? `${hc.runway_days} дн.` : "—" },
          { label: "Сжигание/мес", val: burnRub ? `${burnRub} ₽` : "—" },
          { label: "Красные флаги", val: String(hc.red_flags.length) },
        ].map(m => (
          <div key={m.label} className="k-card k-card--glass biz-metric-card">
            <div className="biz-metric-label">{m.label}</div>
            <div className="biz-metric-val">{m.val}</div>
          </div>
        ))}
      </div>
      {hc.red_flags.length > 0 && (
        <div className="biz-flags">
          {hc.red_flags.map((f, i) => (
            <div key={i} className="biz-flag-item">⚠ {f}</div>
          ))}
        </div>
      )}
      {(intake?.assessment?.strengths?.length ?? 0) > 0 && (
        <div className="biz-strengths">
          <p className="biz-block-title">Сильные стороны плана</p>
          {intake!.assessment.strengths.map((s, i) => (
            <div key={i} className="biz-strength-item">✓ {s}</div>
          ))}
        </div>
      )}
      {gaps.length > 0 && (
        <div className="biz-gaps">
          <p className="biz-block-title">Что нужно для полного анализа ({gaps.length})</p>
          {gaps.slice(0, 8).map(g => (
            <div key={g.sectionId} className="k-card k-card--glass biz-gap-item">
              <span className="biz-gap-name">{g.canInfer ? "✦ " : "📄 "}{g.sectionId.replace(/_/g, " ")}</span>
              {g.whereToGet && <span className="biz-gap-hint">{g.whereToGet}</span>}
              {g.requiredDocKind && (
                <button className="k-nav-btn biz-gap-upload-btn" onClick={() => setUploadKind(g.requiredDocKind!)}>
                  Загрузить
                </button>
              )}
            </div>
          ))}
          {uploadKind && (
            <div style={{ marginTop: 16 }}>
              <UploadBusinessDocsButton defaultKind={uploadKind} onSuccess={() => setUploadKind(null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function BusinessPage() {
  const navigate = useNavigate();
  const { businessId } = useAuth();
  const bid = businessId ?? "";
  const { data: intake } = useIntake(bid);
  const { data: events = [] } = useBusinessEvents(bid);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const mappedSections: MappedSection[] = intake?.mappedSections ?? [];

  const covered = useMemo((): DocMappedSection[] =>
    mappedSections.filter(m => m.present)
      .map(m => ({ sectionId: m.sectionId, pageRange: [0, 0] as [number, number], confidence: m.confidence })),
    [mappedSections],
  );
  const gaps = useMemo(() => deriveGaps(covered), [covered]);

  const balance = events
    .filter(e => e.type === "payment_in" || e.type === "payment_out")
    .reduce((s, e) => s + (e.type === "payment_in" ? e.amount : -e.amount), 0);
  const hc = computeHealthCheck(events, balance);

  const liveCount = SECTIONS.filter(s => {
    const aliasId = BOOK_SECTION_ALIAS[s.id];
    return Boolean(mappedSections.find(m => (m.sectionId === s.id || m.sectionId === aliasId) && m.present));
  }).length;
  const progress = Math.round((liveCount / SECTIONS.length) * 100);

  function showSection(id: string) { setActiveSection(id); setShowAnalysis(false); }
  function backToOverview() { setActiveSection(null); setShowAnalysis(false); }

  return (
    <div className="k-page">
      <div className="k-bg" />
      <div className="k-container">
        {/* ── Сайдбар ──────────────────────────────────────── */}
        <aside className="k-sidebar">
          <div className="k-logo">
            <img src={import.meta.env.BASE_URL + "logo-badge.png"} alt="Kairos" className="k-logo-badge" />
            <div>
              <span className="k-logo-name">KAIROS</span>
              <span className="k-logo-sub">Действующий<br />бизнес</span>
            </div>
          </div>
          <nav className="k-nav">
            <button className={`k-nav-btn${!activeSection && !showAnalysis ? " k-nav-btn--active" : ""}`} onClick={backToOverview}>
              Обзор бизнеса
            </button>
            <button className="k-nav-btn" onClick={() => navigate("/dashboard")}>← Дашборд</button>
            <div className="k-nav-divider" />
            {SECTIONS.map(s => {
              const aliasId = BOOK_SECTION_ALIAS[s.id];
              const isLive = Boolean(mappedSections.find(m => (m.sectionId === s.id || m.sectionId === aliasId) && m.present));
              return (
                <button
                  key={s.id}
                  className={`k-nav-btn k-nav-btn--section biz-section-btn${activeSection === s.id ? " k-nav-btn--active" : ""}`}
                  onClick={() => showSection(s.id)}
                >
                  <span>{s.title}</span>
                  <span className={`biz-dot${isLive ? " biz-dot--live" : ""}`} />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Главная панель ────────────────────────────────── */}
        <main className="k-main">
          <div className="k-main-glint" />
          {/* Header */}
          <header className="k-topbar k-fadein">
            <div className="biz-topbar-left">
              <span className="k-topbar-crumb">
                {activeSection
                  ? `Бизнес · ${SECTIONS.find(s => s.id === activeSection)?.title ?? activeSection}`
                  : showAnalysis ? "Бизнес · Анализ" : "Действующий бизнес · Живой план"}
              </span>
            </div>
            <div className="biz-topbar-right">
              <span className="biz-coverage">Покрытие: {progress}%</span>
              <button className="k-nav-btn biz-hdr-btn" onClick={() => navigate("/dashboard")}>Дашборд →</button>
            </div>
          </header>

          <div className="k-body">
            {activeSection ? (
              <BizSectionView sectionId={activeSection} mappedSections={mappedSections} onBack={backToOverview} />
            ) : showAnalysis ? (
              <BizAnalysisView hc={hc} gaps={gaps} intake={intake} onBack={backToOverview} />
            ) : (
              <>
                <PulseWidget hc={hc} events={events} onSectionClick={showSection} />
                <div className="k-hero-btns" style={{ marginTop: 24 }}>
                  <button className="k-gold-btn" onClick={() => navigate("/dashboard")}>Сформировать →</button>
                  <button
                    className="k-maroon-btn"
                    style={{ background: "#1A1814", boxShadow: "0 3px 12px rgba(0,0,0,.25)" }}
                    onClick={() => setShowAnalysis(true)}
                  >
                    Собрать данные и сформировать стратегию
                  </button>
                </div>
                <div style={{ marginTop: 32 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1814", marginBottom: 8 }}>Загрузить документы бизнеса</p>
                  <p style={{ fontSize: 12, color: "#8B7355", marginBottom: 14, lineHeight: 1.5 }}>
                    Банковская выписка · Кассовые отчёты · Финансовая отчётность · Штатное расписание · Реестр договоров
                  </p>
                  <UploadBusinessDocsButton />
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
