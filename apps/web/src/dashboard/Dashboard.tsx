import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRole } from "../auth/useRole";
import { useFunnelMetrics } from "./useFunnelMetrics";
import { useDemandSignals } from "./useDemandSignals";
import { usePipeline } from "../funnel/usePipeline";
import { useIntake } from "./useIntake";
import type { AssumptionEntry } from "./useIntake";
import { PipelinePanel } from "../funnel/PipelinePanel";
import { StageChart } from "./StageChart";
import { RoadmapPanel } from "./RoadmapPanel";
import { UploadPlanButton } from "./UploadPlanButton";
import { buildGraph, deriveSWOT, RETAIL_TEMPLATE, selectInitialStrategy } from "@crm/core";
import { PlanSidebar } from "./PlanSidebar";

// 22 раздела бизнес-плана — для сайдбара
const PLAN_SECTIONS = [
  "Резюме проекта", "Описание компании", "Анализ рынка", "Продукт / услуга",
  "Маркетинговая стратегия", "Каналы продаж", "Ценовая политика", "Целевая аудитория",
  "Конкурентный анализ", "Операционный план", "Производственный план", "Технологии и ИТ",
  "Кадровый план", "Организационная структура", "Юридическая структура", "Финансовый план",
  "Инвестиционный план", "Риски и меры", "SWOT-анализ", "Партнёры и поставщики",
  "Социальная ответственность", "Стратегия выхода",
];
import { RisksPanel } from "../panels/RisksPanel";
import { AutonomyPanel } from "../panels/AutonomyPanel";
import { ComplianceFlow } from "../features/compliance/ComplianceFlow.js";
import "./Dashboard.css";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

function findAssumption(
  assumptions: Record<string, AssumptionEntry>,
  ...keywords: string[]
): AssumptionEntry | null {
  const lowerKeys = keywords.map(k => k.toLowerCase());
  for (const [key, entry] of Object.entries(assumptions)) {
    if (lowerKeys.some(kw => key.toLowerCase().includes(kw))) return entry;
  }
  return null;
}

function formatAssumptionRub(entry: AssumptionEntry): string {
  const raw = entry.value.point ?? entry.value.lo ?? entry.value.hi;
  if (raw == null) return "—";
  const amount = entry.unit.toLowerCase().includes("kopeck") ? raw / 100 : raw;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amount);
}

function formatPayback(entry: AssumptionEntry): string {
  const raw = entry.value.point ?? entry.value.lo ?? entry.value.hi;
  if (raw == null) return "—";
  const unit = entry.unit.toLowerCase();
  if (unit.includes("year") || unit.includes("год") || unit.includes("лет")) return `${raw} лет`;
  return `${raw} мес.`;
}

// ── SVG Icons (stroke-width 1.4, viewBox 0 0 16 16) ─────────────────────────

const IcoHome = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <path d="M2 6.5L8 2l6 4.5V14H10v-3H6v3H2V6.5Z"/>
  </svg>
);
const IcoPipe = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="2" y="3" width="3" height="10" rx="1"/><rect x="6.5" y="6" width="3" height="7" rx="1"/><rect x="11" y="8" width="3" height="5" rx="1"/>
  </svg>
);
const IcoFin = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M2 12h12M4 12V7m3 5V5m3 7V9m3 3V4"/>
  </svg>
);
const IcoAssess = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="2" y="2" width="12" height="12" rx="2"/>
    <path d="M5 8l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IcoRisk = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <path d="M8 2l6 11H2L8 2Z"/>
    <path d="M8 7v2.5" strokeLinecap="round"/>
    <circle cx="8" cy="11.5" r=".6" fill="currentColor" stroke="none"/>
  </svg>
);
const IcoAuto = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="8" cy="8" r="5.5"/>
    <path d="M8 5v3.5l2 1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IcoShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IcoSearch = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/>
  </svg>
);
const IcoBell = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M8 2a4 4 0 0 0-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 0 0-4-4Z" strokeLinejoin="round"/>
    <path d="M6.5 13.4a1.6 1.6 0 0 0 3 0" strokeLinecap="round"/>
  </svg>
);
const IcoGear = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="8" r="2.2"/>
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>
  </svg>
);

// ── Gold balls physics ───────────────────────────────────────────────────────
// 6 шаров: 0-4 отскакивают, 5-й следует за курсором

const BALL_INIT = [
  { size: 58, rx: 0.10, ry: 0.24 },
  { size: 42, rx: 0.16, ry: 0.70 },
  { size: 34, rx: 0.90, ry: 0.30 },
  { size: 48, rx: 0.82, ry: 0.80 },
  { size: 30, rx: 0.50, ry: 0.10 },
  { size: 40, rx: 0.94, ry: 0.58 },
];

function useBalls() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(
    BALL_INIT.map(b => ({
      x: b.rx * window.innerWidth,
      y: b.ry * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      size: b.size,
    }))
  );
  const mouseRef = useRef({ x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 });
  const rafRef = useRef(0);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("mousemove", onMouse);

    const tick = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const s = stateRef.current;
      const el = containerRef.current;
      if (!el) { rafRef.current = requestAnimationFrame(tick); return; }
      const children = el.children as HTMLCollectionOf<HTMLImageElement>;

      for (let i = 0; i < s.length; i++) {
        const b = s[i];
        if (i < 5) {
          // линейное движение + отскок
          b.x += b.vx;
          b.y += b.vy;
          if (b.x - b.size / 2 < 0)  { b.x = b.size / 2; b.vx = Math.abs(b.vx); }
          if (b.x + b.size / 2 > W)  { b.x = W - b.size / 2; b.vx = -Math.abs(b.vx); }
          if (b.y - b.size / 2 < 0)  { b.y = b.size / 2; b.vy = Math.abs(b.vy); }
          if (b.y + b.size / 2 > H)  { b.y = H - b.size / 2; b.vy = -Math.abs(b.vy); }
        } else {
          // пружина к курсору
          const mx = mouseRef.current.x, my = mouseRef.current.y;
          b.vx += (mx - b.x) * 0.0016;
          b.vy += (my - b.y) * 0.0016;
          b.vx *= 0.94; b.vy *= 0.94;
          b.x += b.vx; b.y += b.vy;
        }
        if (children[i]) {
          children[i].style.transform = `translate(${b.x - b.size / 2}px, ${b.y - b.size / 2}px)`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", onMouse);
    };
  }, []);

  return { containerRef, balls: stateRef.current };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { businessId, logout, role } = useAuth();
  const bid = businessId ?? "demo";
  const { roleRecord } = useRole(bid);
  const { entityAccess, dashboardWidgets } = roleRecord;

  const { stages, totalDeals: funnelTotalDeals } = useFunnelMetrics(bid);
  const { signals } = useDemandSignals(bid);
  const { data: pipeline } = usePipeline(bid);
  const { data: intake } = useIntake(bid);

  const isOwner = !role || role === "owner";

  type View = "dashboard" | "pipeline" | "finances" | "intake" | "risks" | "autonomy" | "compliance";
  const [view, setView] = useState<View>("dashboard");
  const [activeNav, setActiveNav] = useState(0);
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);

  const { containerRef } = useBalls();

  // CRM data
  const nonTerminal = stages.filter(s => !s.terminal);
  const totalDeals = pipeline?.size ?? funnelTotalDeals;
  const pipelineWt = stages.reduce((sum, s) => sum + s.weightedPipeline, 0);
  const firstConv = nonTerminal[0]?.factConversion;
  const hasDeals = totalDeals > 0;

  const capexEntry = useMemo(() => findAssumption(intake?.assessment.assumptionsExtracted ?? {}, "capex", "capital", "invest", "инвест", "капит"), [intake]);
  const opexEntry  = useMemo(() => findAssumption(intake?.assessment.assumptionsExtracted ?? {}, "opex", "oper", "расход", "затрат", "expense", "cost"), [intake]);
  const paybackEntry = useMemo(() => findAssumption(intake?.assessment.assumptionsExtracted ?? {}, "payback", "окупаем", "срок"), [intake]);
  const marginEntry  = useMemo(() => findAssumption(intake?.assessment.assumptionsExtracted ?? {}, "margin", "маржа", "рентаб"), [intake]);

  const marginDisplay = useMemo((): string | null => {
    if (!marginEntry) return null;
    const raw = marginEntry.value.point ?? marginEntry.value.lo ?? marginEntry.value.hi;
    if (raw == null) return null;
    return `${Math.round(raw > 1 ? raw : raw * 100)}%`;
  }, [marginEntry]);

  const opportunities = useMemo(() => {
    const graph = buildGraph(RETAIL_TEMPLATE);
    return deriveSWOT(graph).opportunities;
  }, []);

  const initialStrategy = useMemo(() => {
    const texts = [
      ...(intake?.assessment.strengths ?? []),
      ...(intake?.assessment.concerns ?? []).map(c => c.description),
    ].join(" ").toLowerCase();
    return selectInitialStrategy({
      nicheTags: texts.match(/[а-яёa-z]+/g) ?? [],
      assessment: intake?.assessment ? {
        strengths: intake.assessment.strengths,
        concerns: intake.assessment.concerns,
        gaps: intake.assessment.gaps,
      } : undefined,
    });
  }, [intake]);

  const showDeals = entityAccess.deals !== "none" && dashboardWidgets.includes("pipeline");
  const showFinancials = entityAccess.financials !== "none" && dashboardWidgets.includes("cash_forecast");
  const showDemandSignals = signals !== null && dashboardWidgets.includes("demand_signals");

  // Скрыть HTML-спираль — нужна только на логине
  useEffect(() => {
    const panel = document.getElementById("spiral-panel");
    const root  = document.getElementById("root");
    if (panel) panel.style.display = "none";
    if (root)  root.style.width = "100%";
    return () => {
      if (panel) panel.style.display = "";
      if (root)  root.style.width = "";
    };
  }, []);

  // Nav items — Воронка (idx 1) и Финансы (idx 2) скрыты (hidden:true), данные сохранены
  const navItems = [
    { label: "Дашборд",   icon: <IcoHome />,   view: "dashboard" as View, idx: 0 },
    { label: "Воронка",   icon: <IcoPipe />,   view: "pipeline"  as View, idx: 1, hidden: true },
    { label: "Финансы",   icon: <IcoFin />,    view: "finances"  as View, idx: 2, hidden: true },
    { label: "Оценка",    icon: <IcoAssess />, view: "intake"    as View, idx: 3 },
    { label: "Риски",     icon: <IcoRisk />,   view: "risks"     as View, idx: 4 },
    { label: "Автономия", icon: <IcoAuto />,   view: "autonomy"  as View, idx: 5 },
    { label: "Комплаенс", icon: <IcoShield />, view: "compliance" as View, idx: 6 },
  ];

  // Demo chart data (из спеки)
  const cashBarHeights = [28, 40, 34, 55, 62, 78, 92];
  const planFactData   = [[62,48],[70,66],[58,62],[80,74],[88,92],[95,84]];
  const gapBarVals     = [42, 55, 38, 60, 30, -45, 52, 66];

  // Stage cards — реальные данные или демо
  const stageCards = stages.length >= 4
    ? stages.slice(0, 4).map((s, i) => ({
        name: s.stageName,
        value: formatRub(s.weightedPipeline),
        sub: `${s.count} сд · ${Math.round(s.factConversion * 100)}%`,
      }))
    : [
        { name: "Лид",           value: "412 тыс ₽",   sub: "9 сд · 34%" },
        { name: "Квалификация",  value: "1,28 млн ₽",  sub: "6 сд · 52%" },
        { name: "Предложение",   value: "940 тыс ₽",   sub: "4 сд · 61%" },
        { name: "Сделка",        value: "2,05 млн ₽",  sub: "3 сд · 88%" },
      ];

  const stageGrads = [
    { bg: "linear-gradient(135deg,#8A6415 0%,#B98D2A 15%,#E4C260 34%,#F7E4A0 50%,#E0BA4C 64%,#A67E1E 83%,#7C5C12 100%)", text: "#4A3208", sub: "rgba(74,50,8,.65)", dot: "#6A4E10" },
    { bg: "linear-gradient(135deg,#6E3F1C 0%,#995C2C 15%,#C68B4A 33%,#E9B778 46%,#F3D29A 52%,#C88A46 64%,#8E5427 82%,#5F3818 100%)", text: "#FFF2D8", sub: "rgba(255,242,216,.55)", dot: "#E9B778" },
    { bg: "linear-gradient(135deg,#5A3316 0%,#83502A 16%,#B27A42 34%,#D9A768 50%,#A96E38 64%,#7A481F 83%,#4E2E13 100%)", text: "#FFF2D8", sub: "rgba(255,242,216,.55)", dot: "#D9A768" },
    { bg: "linear-gradient(135deg,#A6791C 0%,#D4AB40 16%,#F4DE88 40%,#FFF6CC 52%,#E4BF52 66%,#B0851F 84%,#8A6614 100%)", text: "#4A3208", sub: "rgba(74,50,8,.65)", dot: "#7A5810" },
  ];

  return (
    <div className="k-page">
      {/* ── Фон ─────────────────────────────────────────────────────── */}
      <div className="k-bg" />

      {/* ── Летающие золотые шары ───────────────────────────────────── */}
      <div ref={containerRef} className="k-balls-layer" aria-hidden="true">
        {BALL_INIT.map((b, i) => (
          <img
            key={i}
            src={import.meta.env.BASE_URL + "ball-gold.png"}
            alt=""
            className="k-ball"
            style={{ width: b.size, height: b.size }}
          />
        ))}
      </div>

      {/* ── Основной контейнер ──────────────────────────────────────── */}
      <div className="k-container">

        {/* ── Сайдбар ─────────────────────────────────────────────── */}
        <aside className="k-sidebar">
          {/* Логотип */}
          <div className="k-logo">
            <img src={import.meta.env.BASE_URL + "logo-badge.png"} alt="Kairos" className="k-logo-badge" />
            <div>
              <span className="k-logo-name">KAIROS</span>
              <span className="k-logo-sub">Цифровой двойник<br />вашего бизнеса</span>
            </div>
          </div>

          {/* Навигация */}
          <nav className="k-nav">
            {navItems.filter(item => !item.hidden).map(item => (
              <button
                key={item.idx}
                className={"k-nav-btn" + (activeNav === item.idx ? " k-nav-btn--active" : "")}
                onClick={() => { setActiveNav(item.idx); setView(item.view); }}
              >
                <span className="k-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
            {/* Разделы бизнес-плана */}
            <div className="k-nav-divider" />
            {PLAN_SECTIONS.map((title, i) => (
              <button
                key={"ps-" + i}
                className={"k-nav-btn k-nav-btn--section" + (activeNav === 100 + i ? " k-nav-btn--active" : "")}
                onClick={() => { setActiveNav(100 + i); setView("intake"); }}
              >
                {title}
              </button>
            ))}
          </nav>

          {/* Вращающаяся спираль */}
          <div className="k-spiral-wrap">
            <img src={import.meta.env.BASE_URL + "spiral.png"} alt="" className="k-spiral" />
          </div>

          {/* User badge */}
          <div className="k-user">
            <div className="k-user-row">
              <span className="k-user-bid">{bid}</span>
              <span className="k-user-role">{role === "manager" ? "Менеджер" : "Владелец"}</span>
            </div>
            <button className="k-logout" onClick={() => void logout()}>Выйти →</button>
          </div>
        </aside>

        {/* Боковая панель плана */}
        {isOwner && <PlanSidebar intake={intake} isOpen={planSidebarOpen} />}

        {/* ── Стеклянная главная панель ───────────────────────────── */}
        <main className="k-main">
          {/* Блик */}
          <div className="k-main-glint" />

          {/* Риски */}
          {isOwner && (
            <div className="k-body" style={{ display: view === "risks" ? undefined : "none" }}>
              <RisksPanel assessment={intake?.assessment ?? null} />
            </div>
          )}
          {/* Автономия */}
          {isOwner && (
            <div className="k-body" style={{ display: view === "autonomy" ? undefined : "none" }}>
              <AutonomyPanel businessId={bid} />
            </div>
          )}
          {/* Комплаенс */}
          {view === "compliance" && (
            <div className="k-body">
              <ComplianceFlow businessId={bid} />
            </div>
          )}

          {/* Оценка */}
          <div className="k-body" style={{ display: view === "intake" ? undefined : "none" }}>
            {intake
              ? <RoadmapPanel intake={intake} businessId={bid} />
              : <div className="k-empty-state" style={{ height: "60vh" }}>
                  <span style={{ fontSize: 28, opacity: .3 }}>○</span>
                  <p>Загрузите бизнес-план — появится оценка предприятия</p>
                  {isOwner && <UploadPlanButton />}
                </div>
            }
          </div>

          {/* ── Дашборд ── */}
          <div className="k-body" style={{ display: view === "dashboard" ? undefined : "none" }}>

            {/* Topbar */}
            <header className="k-topbar k-fadein" style={{ animationDelay: ".05s" }}>
              <span className="k-topbar-crumb">Дашборд · Живой бизнес-план</span>
              <div className="k-topbar-right">
                {/* Иконки */}
                {[
                  { ic: <IcoSearch />, label: "Поиск", dot: false },
                  { ic: <IcoBell />,   label: "Уведомления", dot: true },
                  { ic: <IcoGear />,   label: "Настройки", dot: false },
                ].map(({ ic, label, dot }) => (
                  <button key={label} className="k-icon-btn" aria-label={label}>
                    {ic}
                    {dot && <span className="k-notif-dot" />}
                  </button>
                ))}
                {/* Бардовая кнопка */}
                <button className="k-maroon-btn">Приступить к работе</button>
                {/* Профиль */}
                <div className="k-profile-pill">
                  <span className="k-profile-name">
                    {role === "manager" ? "Менеджер" : "Владелец"}
                  </span>
                  <div className="k-avatar" />
                </div>
              </div>
            </header>

            {/* H1 */}
            {/* UploadPlanButton скрыт — нужен только как триггер */}
            <div style={{ display: "none" }}>{isOwner && <UploadPlanButton />}</div>
            <div className="k-hero k-fadein" style={{ animationDelay: ".1s" }}>
              <h1 className="k-h1">Живой бизнес-план</h1>
              <p className="k-h1-sub">Цифровой двойник вашего бизнеса</p>
              <div className="k-hero-btns">
                {isOwner && (
                  <button className="k-gold-btn"
                    onClick={() => document.querySelector<HTMLElement>(".upload-plan-btn")?.click()}>
                    Загрузить бизнес-план
                  </button>
                )}
                <button className="k-green-btn"
                  onClick={() => { setView("intake"); setActiveNav(3); }}>
                  Оценить бизнес план
                </button>
              </div>
            </div>

            {/* 3-column grid */}
            <div className="k-grid k-fadein" style={{ animationDelay: ".18s" }}>

              {/* Левая колонка */}
              <div className="k-col">
                {/* Cash Flow */}
                <div className="k-card k-card--glass">
                  <div className="k-card-head">
                    <span className="k-card-title">Cash Flow</span>
                    <span className="k-badge k-badge--gold">+12,4%</span>
                  </div>
                  <div className="k-bars" style={{ height: 84 }}>
                    {cashBarHeights.map((h, i) => (
                      <div
                        key={i}
                        className="k-bar"
                        style={{
                          height: `${h}%`,
                          background: i < 5
                            ? "#C89A34"
                            : "linear-gradient(180deg,#E9B778,#A6771F)",
                        }}
                      />
                    ))}
                  </div>
                  <p className="k-caption">
                    {showFinancials && pipelineWt > 0
                      ? `Взвешенный pipeline: ${formatRub(pipelineWt)}`
                      : "Прогноз на 6 мес · из плана"}
                  </p>
                </div>

                {/* CAPEX/OPEX — металл бронза */}
                <div className="k-card k-card--bronze">
                  <div className="k-glint" />
                  <div style={{ position: "relative" }}>
                    <p className="k-card-title" style={{ color: "#FFF2D8" }}>CAPEX / OPEX</p>
                    <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
                      <div>
                        <p className="k-metal-label">Капзатраты</p>
                        <p className="k-metal-val">
                          {capexEntry ? formatAssumptionRub(capexEntry) : "12,4 млн ₽"}
                        </p>
                      </div>
                      <div>
                        <p className="k-metal-label">Опзатраты</p>
                        <p className="k-metal-val">
                          {opexEntry ? formatAssumptionRub(opexEntry) : "860 тыс ₽"}
                        </p>
                      </div>
                    </div>
                    <p className="k-metal-caption">из бизнес-плана · §4 Финансы</p>
                  </div>
                </div>

                {/* Срок окупаемости */}
                <div className="k-card k-card--glass">
                  <p className="k-card-title">Срок окупаемости</p>
                  <p className="k-metric">
                    {paybackEntry ? formatPayback(paybackEntry) : "18"}{" "}
                    <span className="k-metric-unit">мес.</span>
                  </p>
                  <p className="k-caption">точка ноля — 1,45 млн ₽/мес</p>
                </div>
              </div>

              {/* Центр */}
              <div className="k-col k-col--center">
                {/* Окно предприятия */}
                <div className="k-window">
                  <div className="k-window-bar">
                    <span className="k-dot k-dot--red" />
                    <span className="k-dot k-dot--yellow" />
                    <span className="k-dot k-dot--green" />
                    <div className="k-url-pill" />
                    <span className="k-chevron">›</span>
                  </div>
                  <div className="k-window-body">
                    {!hasDeals && (
                      <div className="k-empty-state">
                        <span style={{ fontSize: 28, opacity: .3 }}>○</span>
                        <p>Загрузите бизнес-план — появится живой макет предприятия</p>
                      </div>
                    )}
                    {hasDeals && showDeals && (
                      <div id="pipeline">
                        <PipelinePanel filterMine={role === "manager"} />
                      </div>
                    )}
                  </div>
                </div>

                {/* CTA-бар */}
                <div className="k-cta-bar">
                  <span style={{ fontSize: 13, color: "#8B7355" }}>
                    <b style={{ color: "#1A1814" }}>
                      {hasDeals ? "Воронка активна" : "Воронка спит"}
                    </b>
                    {" "}— {hasDeals ? `${totalDeals} сделок` : "активируется с первой сделкой"}
                  </span>
                </div>
              </div>

              {/* Правая колонка */}
              <div className="k-col">
                {/* План / факт */}
                <div className="k-card k-card--glass">
                  <div className="k-card-head">
                    <span className="k-card-title">План / факт</span>
                    <span className="k-badge k-badge--gold">92%</span>
                  </div>
                  <div className="k-bars k-bars--grouped" style={{ height: 96 }}>
                    {planFactData.map(([plan, fact], i) => (
                      <div key={i} className="k-bar-group">
                        <div className="k-bar" style={{ height: `${plan}%`, background: "rgba(180,140,60,.3)" }} />
                        <div className="k-bar" style={{ height: `${fact}%`, background: "linear-gradient(180deg,#E0B24A,#A6771F)" }} />
                      </div>
                    ))}
                  </div>
                  <div className="k-legend">
                    <span><i className="k-legend-dot" style={{ background: "rgba(180,140,60,.3)" }} />план</span>
                    <span><i className="k-legend-dot" style={{ background: "#B8871F" }} />факт</span>
                  </div>
                </div>

                {/* Сигналы спроса */}
                {showDemandSignals && signals ? (
                  <div className="k-card k-card--glass">
                    <p className="k-card-title">Сигналы спроса</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 12 }}>
                      <div>
                        <p className="k-serif-big">{signals.leads.toLocaleString("ru-RU")}</p>
                        <p className="k-caption">лидов за квартал</p>
                      </div>
                      <div
                        className="k-donut"
                        style={{ background: `conic-gradient(#C99A34 0 ${Math.round(signals.qualifiedRate * 100)}%, rgba(200,160,60,.18) ${Math.round(signals.qualifiedRate * 100)}% 100%)` }}
                      >
                        <div className="k-donut-inner">{Math.round(signals.qualifiedRate * 100)}</div>
                      </div>
                    </div>
                    <p className="k-caption" style={{ marginTop: 12 }}>
                      {Math.round(signals.qualifiedRate * 100)}% квалифицировано · тренд {signals.trendScore > 0.1 ? "▲" : signals.trendScore < -0.1 ? "▼" : "→"}
                    </p>
                  </div>
                ) : (
                  <div className="k-card k-card--glass">
                    <p className="k-card-title">Сигналы спроса</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 12 }}>
                      <div>
                        <p className="k-serif-big">1 159</p>
                        <p className="k-caption">лидов за квартал</p>
                      </div>
                      <div className="k-donut" style={{ background: "conic-gradient(#C99A34 0 43%, rgba(200,160,60,.18) 43% 100%)" }}>
                        <div className="k-donut-inner">43</div>
                      </div>
                    </div>
                    <p className="k-caption" style={{ marginTop: 12 }}>43% квалифицировано · тренд ▲</p>
                  </div>
                )}

                {/* Gap Forecast */}
                <div className="k-card k-card--glass" id="finances">
                  <div className="k-card-head">
                    <span className="k-card-title">Gap Forecast</span>
                    <span className="k-badge k-badge--red">−310 тыс ₽</span>
                  </div>
                  <div className="k-bars" style={{ height: 64, marginTop: 16 }}>
                    {gapBarVals.map((v, i) => (
                      <div
                        key={i}
                        className="k-bar"
                        style={{
                          height: `${Math.abs(v)}%`,
                          background: v < 0 ? "#8B2E3C" : "rgba(190,145,55,.55)",
                          alignSelf: v < 0 ? "flex-end" : "flex-start",
                        }}
                      />
                    ))}
                  </div>
                  <p className="k-caption" style={{ marginTop: 12 }}>кассовый разрыв — октябрь</p>
                </div>
              </div>
            </div>

            {/* Нижний ряд — 4 металлических этапа */}
            <div className="k-stage-grid k-fadein" style={{ animationDelay: ".36s" }}>
              {stageCards.map((s, i) => (
                <div
                  key={i}
                  className="k-stage-card"
                  style={{ background: stageGrads[i].bg }}
                >
                  <div className="k-glint" />
                  <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: stageGrads[i].text }}>{s.name}</p>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: stageGrads[i].dot }} />
                  </div>
                  <p style={{ position: "relative", margin: "12px 0 0", fontSize: 24, fontWeight: 600, color: stageGrads[i].text, letterSpacing: "-.02em" }}>{s.value}</p>
                  <p style={{ position: "relative", margin: "5px 0 0", fontSize: 12, color: stageGrads[i].sub }}>{s.sub}</p>
                </div>
              ))}
            </div>

          </div>{/* end k-body dashboard */}
        </main>
      </div>
    </div>
  );
}
