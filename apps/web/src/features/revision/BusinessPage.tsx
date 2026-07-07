import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useIntake } from "../../dashboard/useIntake";
import { useBusinessEvents } from "../reporting/useBusinessEvents";
import { computeHealthCheck, deriveGaps } from "@crm/core";
import type { DocMappedSection } from "@crm/schemas";
import { SECTIONS, SECTION_TO_INTAKE_ID } from "../../plan/PlanSectionPage";
import { PulseWidget } from "./PulseWidget";
import { UploadPlanButton } from "../../dashboard/UploadPlanButton";
import "../../dashboard/Dashboard.css";
import "./BusinessPage.css";

export function BusinessPage() {
  const navigate = useNavigate();
  const { businessId } = useAuth();
  const bid = businessId ?? "";
  const { data: intake } = useIntake(bid);
  const { data: events = [] } = useBusinessEvents(bid);

  const mappedSections = intake?.mappedSections ?? [];

  const covered = useMemo((): DocMappedSection[] =>
    mappedSections
      .filter(m => m.present)
      .map(m => ({ sectionId: m.sectionId, pageRange: [0, 0] as [number, number], confidence: m.confidence })),
    [mappedSections],
  );
  const gaps = useMemo(() => deriveGaps(covered), [covered]);

  const balance = events
    .filter(e => e.type === "payment_in" || e.type === "payment_out")
    .reduce((s, e) => s + (e.type === "payment_in" ? e.amount : -e.amount), 0);
  const hc = computeHealthCheck(events, balance);

  const liveCount = SECTIONS.filter(s => {
    const id = SECTION_TO_INTAKE_ID[s.id];
    return id ? Boolean(mappedSections.find(m => m.sectionId === id && m.present)) : false;
  }).length;
  const progress = Math.round((liveCount / SECTIONS.length) * 100);

  return (
    <div className="k-page">
      <div className="k-bg" />

      <div className="k-container">
        {/* ── Сайдбар ───────────────────────────────────────────────── */}
        <aside className="k-sidebar">
          <div className="k-logo">
            <img src={import.meta.env.BASE_URL + "logo-badge.png"} alt="Kairos" className="k-logo-badge" />
            <div>
              <span className="k-logo-name">KAIROS</span>
              <span className="k-logo-sub">Действующий<br />бизнес</span>
            </div>
          </div>

          <nav className="k-nav">
            <button className="k-nav-btn k-nav-btn--active" onClick={() => navigate("/business")}>
              Обзор бизнеса
            </button>
            <button className="k-nav-btn" onClick={() => navigate("/dashboard")}>
              ← Дашборд
            </button>
            <div className="k-nav-divider" />
            {SECTIONS.map(s => {
              const intakeId = SECTION_TO_INTAKE_ID[s.id];
              const isLive = intakeId
                ? Boolean(mappedSections.find(m => m.sectionId === intakeId && m.present))
                : false;
              return (
                <button
                  key={s.id}
                  className="k-nav-btn k-nav-btn--section biz-section-btn"
                  onClick={() => navigate(`/business/plan/${s.id}`)}
                >
                  <span>{s.title}</span>
                  <span className={`biz-dot${isLive ? " biz-dot--live" : ""}`} />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Главная панель ─────────────────────────────────────────── */}
        <main className="k-main">
          <div className="k-main-glint" />
          <div className="k-body">

            <header className="k-topbar k-fadein">
              <span className="k-topbar-crumb">Действующий бизнес · Живой план</span>
              <span style={{ fontSize: 13, color: "#8B7355" }}>
                Покрытие данных: {progress}%
              </span>
            </header>

            <PulseWidget
              hc={hc}
              events={events}
              onSectionClick={id => navigate(`/business/plan/${id}`)}
            />

            <div className="k-hero-btns" style={{ marginTop: 24 }}>
              <button className="k-gold-btn" onClick={() => navigate("/dashboard")}>
                Сформировать →
              </button>
              <button
                className="k-maroon-btn"
                style={{ background: "#1A1814", boxShadow: "0 3px 12px rgba(0,0,0,.25)" }}
                onClick={() => navigate("/dashboard")}
              >
                Собрать данные и сформировать стратегию
              </button>
            </div>

            {/* Загрузка документов */}
            <div style={{ marginTop: 32 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1814", marginBottom: 8 }}>
                Загрузить документы бизнеса
              </p>
              <p style={{ fontSize: 12, color: "#8B7355", marginBottom: 14, lineHeight: 1.5 }}>
                Банковская выписка · Кассовые отчёты · Финансовая отчётность · Штатное расписание · Реестр договоров
              </p>
              <UploadPlanButton />
            </div>

            {/* Gap CTAs от deriveGaps */}
            {gaps.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1814", marginBottom: 10 }}>
                  Что нужно для полного анализа ({gaps.length} разделов)
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {gaps.slice(0, 6).map(g => (
                    <div
                      key={g.sectionId}
                      className="k-card k-card--glass"
                      style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <span style={{ fontSize: 12, color: "#1A1814", flex: 1 }}>
                        {g.canInfer ? "✦ " : "📄 "}
                        {g.sectionId.replace(/_/g, " ")}
                      </span>
                      <span style={{ fontSize: 11, color: "#8B7355" }}>
                        {g.whereToGet}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}
