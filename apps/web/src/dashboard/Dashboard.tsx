import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { BOOK_SECTION_ALIAS } from "@crm/schemas";
import { PlanSidebar } from "./PlanSidebar";
import { IntakePanel } from "./IntakePanel";
import { SECTIONS, SECTION_TO_INTAKE_ID } from "../plan/PlanSectionPage";
import type { MappedSection, HolisticAssessment, GeneratedRoadmap, GrantType, GrantResult } from "./useIntake";
import { RisksPanel } from "../panels/RisksPanel";
import { AutonomyPanel } from "../panels/AutonomyPanel";
import { ComplianceFlow } from "../features/compliance/ComplianceFlow.js";
import { ReportingScreen } from "../features/reporting/ReportingScreen.js";
import { AccountingCards } from "../features/accounting/AccountingCards.js";
import { useEntitlements } from "../services/useEntitlements.js";
import { ScenariosPage } from "../scenarios/ScenariosPage.js";
import { VoiceInput } from "../voice/index.js";
import "./Dashboard.css";

function LockedFeature({ title }: { title: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
      <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#1A1814" }}>{title}</h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#8B7355" }}>
        Первый раз — бесплатно. Для повторного использования подключите тариф.
      </p>
      <a href="/crm_life/services" style={{
        display: "inline-block", padding: "10px 24px",
        background: "linear-gradient(135deg,#C89A34,#E4C260)",
        borderRadius: 8, fontWeight: 700, fontSize: 13, color: "#3A2800", textDecoration: "none",
      }}>
        Подключить тариф
      </a>
    </div>
  );
}

// ── Reprocess button ──────────────────────────────────────────────────────────

function ReprocessButton({ businessId }: { businessId: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading"); setMsg(null);
    try {
      const idToken = await user!.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/intake-migrate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json() as { migrated?: number; message?: string };
      setStatus("done");
      setMsg(data.message ?? `Обновлено разделов: ${data.migrated ?? 0}`);
    } catch (e) {
      setStatus("error");
      setMsg(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={status === "loading"}
        style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, border: "1px solid #C89A34", background: "transparent", color: "#8B6914", cursor: "pointer", fontWeight: 600 }}
      >
        {status === "loading" ? "Обрабатываем…" : "⟳ Перераспределить по разделам"}
      </button>
      {msg && <span style={{ fontSize: 12, color: status === "error" ? "#8B1A1A" : "#2E7D32" }}>{msg}</span>}
    </div>
  );
}

// ── Holistic plan assessment ──────────────────────────────────────────────────

// ── Анимированная шкала прогресса AI-операций ────────────────────────────────
function AiProgressBar({ label }: { label: string }) {
  const [pct, setPct] = useState(5);
  useEffect(() => {
    // Имитируем прогресс: быстро до 70%, потом медленно ждём Firestore
    const intervals = [
      setTimeout(() => setPct(25), 800),
      setTimeout(() => setPct(45), 2500),
      setTimeout(() => setPct(62), 6000),
      setTimeout(() => setPct(75), 15000),
      setTimeout(() => setPct(85), 35000),
    ];
    return () => intervals.forEach(clearTimeout);
  }, []);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#C89A34", marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ height: 6, borderRadius: 4, background: "rgba(200,154,52,0.15)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 4,
            background: "linear-gradient(90deg,#C89A34,#E4C260)",
            transition: "width 1.2s ease",
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>Результат появится автоматически…</div>
    </div>
  );
}

function AssessPlanButton({ planId }: { planId: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<"idle" | "loading" | "queued" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!user) return;
    setStatus("loading"); setErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/plan-assess`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      setStatus("queued");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={status === "loading" || status === "queued"}
        style={{ fontSize: 12, padding: "6px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C89A34,#E4C260)", color: "#3A2800", cursor: "pointer", fontWeight: 700 }}
      >
        {status === "loading" ? "Отправляем…" : status === "queued" ? "⏳ В очереди" : "⚡ Оценить весь план (Kairos)"}
      </button>
      {err && <span style={{ fontSize: 12, color: "#C62828" }}>{err}</span>}
    </div>
  );
}

const SEV_COLOR: Record<string, string> = { high: "#C62828", medium: "#E65100", low: "#856404" };

interface AcceptedChange {
  section_key: string;
  original_issue: string;
  applied_text: string;
  user_edited: boolean;
}

function HolisticResultView({ ha, planId }: { ha: HolisticAssessment; planId: string }) {
  const { user } = useAuth();
  const [openSection, setOpenSection] = useState<string | null>(null);
  // key = "sectionKey::commentIndex", value = "accepted" | "rejected"
  const [decisions, setDecisions] = useState<Record<string, "accepted" | "rejected">>({});
  const [reformStatus, setReformStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [reformErr, setReformErr] = useState<string | null>(null);

  const flagged = ha.sections.filter(s => s.verdict === "flagged");
  const approved = ha.sections.filter(s => s.verdict === "approved");

  const decide = (key: string, val: "accepted" | "rejected") =>
    setDecisions(d => ({ ...d, [key]: val }));

  const acceptedChanges: AcceptedChange[] = [];
  for (const sec of flagged) {
    sec.comments.forEach((c, i) => {
      if (decisions[`${sec.section_key}::${i}`] === "accepted") {
        acceptedChanges.push({
          section_key: sec.section_key,
          original_issue: c.issue,
          applied_text: c.suggested_fix,
          user_edited: false,
        });
      }
    });
  }

  async function runReform() {
    if (!user || acceptedChanges.length === 0) return;
    setReformStatus("loading"); setReformErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/plan-reform`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, acceptedChanges }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      setReformStatus("done");
    } catch (e) {
      setReformStatus("error");
      setReformErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const totalComments = flagged.reduce((n, s) => n + s.comments.length, 0);
  const decidedCount = Object.keys(decisions).length;
  const allDecided = decidedCount === totalComments;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1A1814" }}>Оценка Kairos</h3>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#D4EDDA", color: "#155724", fontWeight: 600 }}>✓ {approved.length} одобрено</span>
        {flagged.length > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#F8D7DA", color: "#721C24", fontWeight: 600 }}>⚠ {flagged.length} замечаний</span>}
        <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>{new Date(ha.assessedAt).toLocaleDateString("ru-RU")}</span>
      </div>

      {/* Cross-section issues */}
      {ha.cross_section_issues.length > 0 && (
        <div style={{ padding: "10px 14px", background: "rgba(198,40,40,.06)", border: "1px solid rgba(198,40,40,.2)", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#C62828", marginBottom: 6 }}>Противоречия между разделами</div>
          {ha.cross_section_issues.map((ci, i) => (
            <div key={i} style={{ fontSize: 12, color: "#5A1A1A", marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{ci.sections.join(" ↔ ")}: </span>{ci.issue}
            </div>
          ))}
        </div>
      )}

      {/* Flagged sections */}
      {flagged.map(sec => (
        <div key={sec.section_key} style={{ marginBottom: 8, border: "1px solid rgba(198,40,40,.2)", borderRadius: 8, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setOpenSection(openSection === sec.section_key ? null : sec.section_key)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(198,40,40,.04)", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "#C62828", flex: 1 }}>{sec.section_key}</span>
            <span style={{ fontSize: 11, color: "#888" }}>
              obj {Math.round(sec.scores.objectivity * 100)}% · real {Math.round(sec.scores.realism * 100)}% · just {Math.round(sec.scores.justification * 100)}%
            </span>
            <span style={{ fontSize: 10, color: "#999" }}>{openSection === sec.section_key ? "▲" : "▼"}</span>
          </button>
          {openSection === sec.section_key && (
            <div style={{ padding: "8px 12px" }}>
              {sec.comments.map((c, i) => {
                const dkey = `${sec.section_key}::${i}`;
                const dec = decisions[dkey];
                return (
                  <div key={i} style={{ marginBottom: 12, paddingLeft: 8, borderLeft: `3px solid ${dec === "accepted" ? "#2E7D32" : dec === "rejected" ? "#999" : SEV_COLOR[c.severity] ?? "#999"}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: SEV_COLOR[c.severity] ?? "#999" }}>{c.severity.toUpperCase()}: {c.issue}</div>
                    {c.quote && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", margin: "2px 0" }}>«{c.quote}»</div>}
                    <div style={{ fontSize: 12, color: "#2E5016", marginTop: 2, marginBottom: 6 }}>→ {c.suggested_fix}</div>
                    {!dec && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => decide(dkey, "accepted")}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "none", background: "#2E7D32", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                          Принять
                        </button>
                        <button type="button" onClick={() => decide(dkey, "rejected")}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #bbb", background: "transparent", color: "#666", cursor: "pointer" }}>
                          Отклонить
                        </button>
                      </div>
                    )}
                    {dec === "accepted" && <span style={{ fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>✓ Принято</span>}
                    {dec === "rejected" && <span style={{ fontSize: 11, color: "#999" }}>— Отклонено</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Reform button — visible when at least one change accepted and all decided */}
      {flagged.length > 0 && allDecided && acceptedChanges.length > 0 && reformStatus !== "done" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => void runReform()}
            disabled={reformStatus === "loading"}
            style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1A3E1A,#2E7D32)", color: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            {reformStatus === "loading" ? "Переформируем план…" : `Переформировать план (${acceptedChanges.length} правок)`}
          </button>
          {reformErr && <span style={{ fontSize: 12, color: "#C62828" }}>{reformErr}</span>}
        </div>
      )}
      {reformStatus === "done" && (
        <div style={{ marginTop: 12, padding: "8px 14px", background: "#D4EDDA", borderRadius: 8, fontSize: 13, color: "#155724", fontWeight: 600 }}>
          ✓ План переформирован — разделы обновлены с учётом каскадных изменений
        </div>
      )}
    </div>
  );
}

// ── AI Roadmap ────────────────────────────────────────────────────────────────

function AiRoadmapButton({ planId }: { planId: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!user) return;
    setStatus("loading"); setErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/plan-roadmap`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={status === "loading"}
        style={{ fontSize: 12, padding: "6px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1A3E1A,#2E7D32)", color: "#fff", cursor: "pointer", fontWeight: 700 }}
      >
        {status === "loading" ? "Генерируем дорожную карту…" : status === "done" ? "✓ Готово" : "⚡ Сгенерировать дорожную карту Kairos"}
      </button>
      {err && <span style={{ fontSize: 12, color: "#C62828" }}>{err}</span>}
    </div>
  );
}

function AiRoadmapView({ gr }: { gr: GeneratedRoadmap }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1A1814" }}>Дорожная карта Kairos</h3>
        <span style={{ fontSize: 11, color: "#888" }}>{new Date(gr.generatedAt).toLocaleDateString("ru-RU")}</span>
      </div>
      {gr.phases.map(ph => (
        <div key={ph.phase} style={{ marginBottom: 16, padding: "12px 16px", background: "rgba(200,154,52,.05)", border: "1px solid rgba(200,154,52,.2)", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#C89A34", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ph.phase}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1814" }}>{ph.title}</span>
            <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>+{ph.dueInDays} дн.</span>
          </div>
          <ul style={{ margin: "0 0 8px 0", paddingLeft: 20 }}>
            {ph.actions.map((a, i) => (
              <li key={i} style={{ fontSize: 13, color: "#3A2E1E", marginBottom: 3, lineHeight: 1.5 }}>{a}</li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: "#2E5016", fontWeight: 600 }}>✓ {ph.deliverable}</div>
        </div>
      ))}
    </div>
  );
}

// ── Grant module ──────────────────────────────────────────────────────────────

const GRANT_OPTIONS: { value: GrantType; label: string; maxRub: string }[] = [
  { value: "minek",       label: "Минэкономразвития «Мой бизнес»",         maxRub: "500 тыс. ₽" },
  { value: "agrostartup", label: "Агростартап (МСХП)",                     maxRub: "3 млн ₽" },
  { value: "governor",    label: "Губернаторский грант",                    maxRub: "по региону" },
  { value: "minvostok",   label: "Минвостокразвития (ДФО)",                 maxRub: "5 млн ₽" },
  { value: "skolkovo",    label: "Сколково",                                maxRub: "до 5 млн ₽" },
  { value: "fondprez",    label: "Президентский фонд культ. инициатив",    maxRub: "по конкурсу" },
];

function GrantPanel({ planId, adaptations }: { planId: string; adaptations?: Record<string, GrantResult> }) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<GrantType>("minek");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [openGrant, setOpenGrant] = useState<string | null>(null);

  async function runAdapt() {
    if (!user) return;
    setStatus("loading"); setErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/plan-grant`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, grantType: selected }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const result = adaptations?.[selected];
  const score = result?.readinessScore ?? 0;
  const scoreColor = score >= 75 ? "#2E7D32" : score >= 50 ? "#E65100" : "#C62828";

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1A1814" }}>Грантовый модуль Kairos</h3>

      {/* Selector + button */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <select
          value={selected}
          onChange={e => { setSelected(e.target.value as GrantType); setErr(null); }}
          style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid #C89A34", background: "rgba(200,154,52,.06)", color: "#3A2800", cursor: "pointer" }}
        >
          {GRANT_OPTIONS.map(g => (
            <option key={g.value} value={g.value}>{g.label} — до {g.maxRub}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void runAdapt()}
          disabled={status === "loading"}
          style={{ fontSize: 12, padding: "6px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C89A34,#E4C260)", color: "#3A2800", cursor: "pointer", fontWeight: 700 }}
        >
          {status === "loading" ? "Анализируем…" : "⚡ Проверить готовность"}
        </button>
        {err && <span style={{ fontSize: 12, color: "#C62828" }}>{err}</span>}
      </div>

      {/* Result for selected grant */}
      {result && (
        <div style={{ border: "1px solid rgba(200,154,52,.25)", borderRadius: 10, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", background: "rgba(200,154,52,.06)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#3A2800", flex: 1 }}>{result.grantLabel}</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor }}>{score}%</span>
            <span style={{ fontSize: 11, color: "#888" }}>готовности</span>
          </div>

          {/* Summary */}
          {result.grantSummary && (
            <div style={{ padding: "10px 16px", fontSize: 13, color: "#3A2E1E", lineHeight: 1.6, borderBottom: "1px solid rgba(200,154,52,.15)" }}>
              {result.grantSummary}
            </div>
          )}

          {/* Missing / weak */}
          <div style={{ padding: "10px 16px", display: "flex", gap: 16, flexWrap: "wrap" }}>
            {result.missingSections.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#C62828", marginBottom: 4 }}>Отсутствуют разделы</div>
                {result.missingSections.map(s => (
                  <div key={s} style={{ fontSize: 12, color: "#721C24" }}>✗ {s}</div>
                ))}
              </div>
            )}
            {result.weakSections.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#E65100", marginBottom: 4 }}>Слабые разделы (&lt;60%)</div>
                {result.weakSections.map(s => (
                  <div key={s} style={{ fontSize: 12, color: "#8B3A00" }}>⚠ {s}</div>
                ))}
              </div>
            )}
            {result.missingSections.length === 0 && result.weakSections.length === 0 && (
              <div style={{ fontSize: 12, color: "#2E7D32", fontWeight: 600 }}>✓ Все обязательные разделы заполнены</div>
            )}
          </div>

          {/* Adapted sections accordion */}
          {Object.keys(result.adaptedSections).length > 0 && (
            <div style={{ borderTop: "1px solid rgba(200,154,52,.15)" }}>
              <button
                type="button"
                onClick={() => setOpenGrant(openGrant === selected ? null : selected)}
                style={{ width: "100%", padding: "8px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 12, color: "#8B6914", fontWeight: 600 }}
              >
                {openGrant === selected ? "▲ Скрыть адаптированный план" : "▼ Показать адаптированный план"}
              </button>
              {openGrant === selected && (
                <div style={{ padding: "0 16px 16px" }}>
                  {Object.entries(result.adaptedSections).map(([sid, txt]) => (
                    <div key={sid} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#8B6914", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{sid}</div>
                      <p style={{ margin: 0, fontSize: 13, color: "#3A2E1E", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{txt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ padding: "6px 16px 10px", fontSize: 11, color: "#aaa" }}>
            {new Date(result.generatedAt).toLocaleDateString("ru-RU")}
          </div>
        </div>
      )}

      {/* Previously run grants */}
      {adaptations && Object.keys(adaptations).filter(k => k !== selected).length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(adaptations).filter(([k]) => k !== selected).map(([k, r]) => (
            <button key={k} type="button" onClick={() => setSelected(k as GrantType)}
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #C89A34", background: "transparent", color: "#8B6914", cursor: "pointer" }}>
              {k} — {r.readinessScore}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Plan section content view ─────────────────────────────────────────────────

const VERDICT_LABEL: Record<string, string> = {
  realistic: "✓ Реалистично",
  needs_improvement: "⚠ Требует доработки",
  unrealistic: "✗ Нереалистично",
  insufficient_data: "○ Данных недостаточно",
};
const VERDICT_COLOR: Record<string, string> = {
  realistic: "#2E7D32",
  needs_improvement: "#E65100",
  unrealistic: "#C62828",
  insufficient_data: "#777",
};

function PlanSectionView({ sectionId, mappedSections, onBack, planId }: {
  sectionId: string;
  mappedSections: MappedSection[];
  onBack: () => void;
  planId: string;
}) {
  const { user } = useAuth();
  const [reviewStatus, setReviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showProposed, setShowProposed] = useState(false);
  const [acceptStatus, setAcceptStatus] = useState<"idle" | "loading" | "done">("idle");

  const sec = SECTIONS.find(s => s.id === sectionId);
  const aliasId = BOOK_SECTION_ALIAS[sectionId];
  const intakeId = SECTION_TO_INTAKE_ID[sectionId];
  const mapped = mappedSections.find(m => m.sectionId === sectionId)
    ?? (aliasId ? mappedSections.find(m => m.sectionId === aliasId) : undefined)
    ?? (intakeId ? mappedSections.find(m => m.sectionId === intakeId) : undefined);
  const pct = mapped ? Math.round(mapped.confidence * 100) : 0;
  const review = mapped?.claudeReview;

  async function requestReview() {
    if (!user) return;
    setReviewStatus("loading"); setReviewError(null); setShowProposed(false);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/section-review`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, sectionId, sectionTitle: sec?.title }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      setReviewStatus("idle");
      // Data refreshes via onSnapshot — no extra state needed
    } catch (e) {
      setReviewStatus("error");
      setReviewError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function acceptReview() {
    if (!review?.proposedRewrite || !user) return;
    setAcceptStatus("loading");
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/section-accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, sectionId, acceptedContent: review.proposedRewrite }),
      });
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      setAcceptStatus("done");
    } catch {
      setAcceptStatus("idle");
    }
  }

  const vColor = review ? (VERDICT_COLOR[review.verdict] ?? "#777") : undefined;

  return (
    <div style={{ padding: "8px 0" }}>
      <button className="k-nav-btn" onClick={onBack} style={{ marginBottom: 16 }}>← Назад к оценке</button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>{sec?.icon}</span>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1A1814" }}>{sec?.title ?? sectionId}</h2>
        {mapped?.present
          ? <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: pct >= 70 ? "#D4EDDA" : pct >= 40 ? "#FFF3CD" : "#F8D7DA", color: pct >= 70 ? "#155724" : pct >= 40 ? "#856404" : "#721C24", fontWeight: 600 }}>Уверенность {pct}%</span>
          : <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#F8D7DA", color: "#721C24", fontWeight: 600 }}>Не найден</span>
        }
        {review && !review.accepted && (
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, border: `1px solid ${vColor}`, color: vColor, fontWeight: 600 }}>
            {VERDICT_LABEL[review.verdict] ?? review.verdict}
          </span>
        )}
        {review?.accepted && (
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#D4EDDA", color: "#155724", fontWeight: 600 }}>✓ Принято</span>
        )}
        {review?.successScore !== undefined && !review.accepted && (
          <span style={{ fontSize: 11, color: "#888" }}>Успех: {review.successScore}%</span>
        )}
      </div>

      {/* Toggle original / proposed */}
      {review?.proposedRewrite && !review.accepted && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button type="button" onClick={() => setShowProposed(false)}
            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #ccc", background: !showProposed ? "#1A1814" : "transparent", color: !showProposed ? "#fff" : "#666", cursor: "pointer" }}>
            Оригинал
          </button>
          <button type="button" onClick={() => setShowProposed(true)}
            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #C89A34", background: showProposed ? "#C89A34" : "transparent", color: showProposed ? "#fff" : "#8B6914", cursor: "pointer" }}>
            Версия Kairos
          </button>
        </div>
      )}

      {/* Content */}
      <p style={{ fontSize: 14, lineHeight: 1.65, color: "#3A2E1E", whiteSpace: "pre-wrap", marginBottom: 12 }}>
        {showProposed && review?.proposedRewrite
          ? review.proposedRewrite
          : mapped?.present ? mapped.contentSummary : "Раздел не найден в загруженном документе"}
      </p>

      {/* Kairos reasoning */}
      {review?.reasoning && (
        <div style={{ padding: "10px 14px", background: "rgba(200,154,52,.08)", borderLeft: "3px solid #C89A34", borderRadius: "0 8px 8px 0", marginBottom: 14, fontSize: 13, color: "#5A4008" }}>
          <strong>Kairos:</strong> {review.reasoning}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!review && (
          <button type="button" onClick={() => void requestReview()} disabled={reviewStatus === "loading"}
            style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, border: "1px solid #C89A34", background: "transparent", color: "#8B6914", cursor: "pointer", fontWeight: 600 }}>
            {reviewStatus === "loading" ? "Анализируем…" : "Запросить оценку Kairos"}
          </button>
        )}
        {review && !review.accepted && (
          <button type="button" onClick={() => void requestReview()} disabled={reviewStatus === "loading"}
            style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #bbb", background: "transparent", color: "#666", cursor: "pointer" }}>
            {reviewStatus === "loading" ? "…" : "↺ Переоценить"}
          </button>
        )}
        {review?.proposedRewrite && !review.accepted && showProposed && (
          <button type="button" onClick={() => void acceptReview()} disabled={acceptStatus === "loading"}
            style={{ fontSize: 12, padding: "6px 16px", borderRadius: 8, border: "none", background: "#2E7D32", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            {acceptStatus === "loading" ? "Сохраняем…" : acceptStatus === "done" ? "✓ Принято" : "Принять версию Kairos"}
          </button>
        )}
        {reviewError && <span style={{ fontSize: 12, color: "#C62828" }}>{reviewError}</span>}
      </div>
    </div>
  );
}

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
const IcoDoc = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="1.5" width="10" height="13" rx="1.5"/>
    <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3"/>
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
  const navigate = useNavigate();
  const { businessId, logout, role } = useAuth();
  const bid = businessId ?? "demo";
  const { roleRecord } = useRole(bid);
  const { canCompliance, canReport } = useEntitlements(businessId);
  const { entityAccess, dashboardWidgets } = roleRecord;

  const { stages, totalDeals: funnelTotalDeals } = useFunnelMetrics(bid);
  const { signals } = useDemandSignals(bid);
  const { data: pipeline } = usePipeline(bid);
  const { data: intake } = useIntake(bid);
  const uploadRef = useRef<HTMLInputElement>(null);

  const isOwner = !role || role === "owner";

  type View = "dashboard" | "intake" | "risks" | "autonomy" | "compliance" | "documents" | "scenarios";
  const [view, setView] = useState<View>("dashboard");
  const [activeNav, setActiveNav] = useState(0);
  const [activePlanSection, setActivePlanSection] = useState<string | null>(null);
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
  const [uploadToast, setUploadToast] = useState<{ msg: string; kind: "progress" | "error" | "done" } | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

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

  const navItems = [
    { label: "Дашборд",        icon: <IcoHome />,   idx: 0, onClick: () => { setActiveNav(0); setView("dashboard");  setActivePlanSection(null); } },
    { label: "Продукт/услуга", icon: <IcoDoc />,    idx: 1, onClick: () => { setActiveNav(1); setActivePlanSection("product"); setView("intake"); } },
    { label: "Резюме проекта", icon: <IcoAssess />, idx: 2, onClick: () => { setActiveNav(2); setActivePlanSection("mission"); setView("intake"); } },
    { label: "Риски",          icon: <IcoRisk />,   idx: 4, onClick: () => { setActiveNav(4); setView("risks");      setActivePlanSection(null); } },
    { label: "Оценка",         icon: <IcoAssess />, idx: 3, onClick: () => { setActiveNav(3); setView("intake");     setActivePlanSection(null); } },
    { label: "Сценарии",        icon: <IcoAuto />,   idx: 5, onClick: () => { setActiveNav(5); setView("scenarios"); setActivePlanSection(null); } },
    { label: "Комплаенс",      icon: <IcoShield />, idx: 6, onClick: () => { setActiveNav(6); setView("compliance"); setActivePlanSection(null); } },
    { label: "Отчётность",     icon: <IcoDoc />,    idx: 7, onClick: () => { setActiveNav(7); setView("documents");  setActivePlanSection(null); } },
  ];

  // Stage cards — только реальные данные
  const stageCards = stages.slice(0, 4).map(s => ({
    name: s.stageName,
    value: formatRub(s.weightedPipeline),
    sub: `${s.count} сд · ${Math.round(s.factConversion * 100)}%`,
  }));

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
            {navItems.map(item => (
              <button
                key={item.idx}
                className={"k-nav-btn" + (activeNav === item.idx ? " k-nav-btn--active" : "")}
                onClick={item.onClick}
              >
                <span className="k-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
            {/* Разделы бизнес-плана */}
            <div className="k-nav-divider" />
            {SECTIONS.filter(s => s.id !== "risks").map((s, i) => {
              const aliasId = BOOK_SECTION_ALIAS[s.id];
              const intakeId = SECTION_TO_INTAKE_ID[s.id];
              const isLive = Boolean(
                (intake?.mappedSections ?? []).find(m =>
                  (m.sectionId === s.id || m.sectionId === aliasId || m.sectionId === intakeId) && m.present
                )
              );
              return (
                <button
                  key={"ps-" + i}
                  className={"k-nav-btn k-nav-btn--section" + (activeNav === 100 + i ? " k-nav-btn--active" : "")}
                  onClick={() => { setActiveNav(100 + i); setActivePlanSection(s.id); setView("intake"); }}
                >
                  <span>{s.icon} {s.title}</span>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: isLive ? "#2E7D32" : "rgba(0,0,0,.15)" }} />
                </button>
              );
            })}
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

          {/* Сценарии */}
          {view === "scenarios" && (
            <div className="k-body">
              <ScenariosPage />
            </div>
          )}
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
              {canCompliance
                ? <ComplianceFlow businessId={bid} />
                : <LockedFeature title="Ответ на требование налоговой" />}
            </div>
          )}
          {/* Отчётность */}
          {view === "documents" && (
            <div className="k-body">
              {canReport
                ? <><ReportingScreen businessId={bid} /><AccountingCards /></>
                : <LockedFeature title="Налоговая и управленческая отчётность" />}
            </div>
          )}

          {/* Оценка */}
          <div className="k-body" style={{ display: view === "intake" ? undefined : "none" }}>
            {intake
              ? activePlanSection
                ? activePlanSection === "roadmap"
                  ? <>
                      <button className="k-nav-btn" onClick={() => setActivePlanSection(null)} style={{ marginBottom: 16 }}>← Назад к оценке</button>
                      {isOwner && <AiRoadmapButton planId={intake.intakeId ?? bid} />}
                      {intake.generatedRoadmap && <AiRoadmapView gr={intake.generatedRoadmap} />}
                      <RoadmapPanel intake={intake} businessId={bid} creditsAvailable={true} />
                    </>
                  : <PlanSectionView
                    sectionId={activePlanSection}
                    mappedSections={intake.mappedSections}
                    onBack={() => setActivePlanSection(null)}
                    planId={intake.intakeId ?? bid}
                  />
                : <>
                    {isOwner && (
                      <>
                        <ReprocessButton businessId={bid} />
                        <AssessPlanButton planId={intake.intakeId ?? bid} />
                      </>
                    )}
                    {intake.assessmentStatus === "processing" && (
                      <AiProgressBar label="Kairos анализирует план…" />
                    )}
                    {intake.assessmentStatus === "error" && (
                      <div style={{ fontSize: 12, color: "#C62828", marginBottom: 8 }}>
                        Ошибка анализа: {intake.assessmentError ?? "неизвестная ошибка"}
                      </div>
                    )}
                    {intake.holisticAssessment && (
                      <HolisticResultView ha={intake.holisticAssessment} planId={intake.intakeId ?? bid} />
                    )}
                    <IntakePanel intake={intake} businessId={bid} />
                    {isOwner && (
                      <GrantPanel planId={intake.intakeId ?? bid} adaptations={intake.grantAdaptations} />
                    )}
                  </>
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
                <button className="k-maroon-btn" onClick={() => navigate("/business")}>
                  Приступить к работе
                </button>
                {/* Профиль */}
                <div className="k-profile-pill">
                  <span className="k-profile-name">
                    {role === "manager" ? "Менеджер" : "Владелец"}
                  </span>
                  <div className="k-avatar" />
                </div>
              </div>
            </header>

            {/* Upload status toast */}
            {uploadToast && (
              <div style={{
                position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
                background: uploadToast.kind === "error" ? "#8B1A1A" : "#1A2E1A",
                color: "#fff", borderRadius: 10, padding: "12px 20px",
                fontSize: 13, fontWeight: 500, zIndex: 9999,
                boxShadow: "0 4px 20px rgba(0,0,0,.35)",
                display: "flex", alignItems: "center", gap: 10, maxWidth: 440,
              }}>
                {uploadToast.kind === "progress" && (
                  <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,.3)", borderTop: "2px solid #fff", borderRadius: "50%", animation: "kSpin 0.8s linear infinite" }} />
                )}
                {uploadToast.kind === "error" && "⚠️ "}
                {uploadToast.kind === "done" && "✓ "}
                {uploadToast.msg}
                <button onClick={() => setUploadToast(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.6)", cursor: "pointer", marginLeft: 6, fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            )}

            {/* H1 */}
            {/* UploadPlanButton скрыт визуально, ref даёт прямой доступ к <input> */}
            {isOwner && (
              <div style={{ display: "none" }}>
                <UploadPlanButton
                  ref={uploadRef}
                  onUploadStart={() => setUploadToast({ msg: "Загружаем файл…", kind: "progress" })}
                  onUploadProgress={msg => setUploadToast({ msg, kind: "progress" })}
                  onUploadError={msg => setUploadToast({ msg, kind: "error" })}
                  onSuccess={() => { setUploadToast({ msg: "Анализ завершён — данные обновляются", kind: "done" }); setTimeout(() => setUploadToast(null), 4000); }}
                />
              </div>
            )}
            <div className="k-hero k-fadein" style={{ animationDelay: ".1s" }}>
              <h1 className="k-h1">Живой бизнес-план</h1>
              <p className="k-h1-sub">Цифровой двойник вашего бизнеса</p>
              <div className="k-hero-btns">
                {isOwner && (
                  <button className="k-gold-btn" onClick={() => uploadRef.current?.click()}>
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
                  </div>
                  <div className="k-bars" style={{ height: 84, alignItems: "flex-end" }}>
                    {showFinancials && pipelineWt > 0
                      ? <div className="k-bar" style={{ height: "100%", background: "linear-gradient(180deg,#E9B778,#A6771F)", flex: 1 }} />
                      : <p className="k-caption" style={{ margin: "auto" }}>—</p>}
                  </div>
                  <p className="k-caption">
                    {showFinancials && pipelineWt > 0
                      ? `Взвешенный pipeline: ${formatRub(pipelineWt)}`
                      : "Данные появятся после загрузки выписки"}
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
                          {capexEntry ? formatAssumptionRub(capexEntry) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="k-metal-label">Опзатраты</p>
                        <p className="k-metal-val">
                          {opexEntry ? formatAssumptionRub(opexEntry) : "—"}
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
                    {paybackEntry ? formatPayback(paybackEntry) : "—"}
                  </p>
                  <p className="k-caption">из бизнес-плана · §4 Финансы</p>
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
                    {hasDeals
                      ? <><b style={{ color: "#1A1814" }}>Сделки активны</b>{` — ${totalDeals} сделок`}</>
                      : "Загрузите бизнес-план — здесь появится живой план предприятия"}
                  </span>
                </div>
              </div>

              {/* Правая колонка */}
              <div className="k-col">
                {/* План / факт */}
                <div className="k-card k-card--glass">
                  <div className="k-card-head">
                    <span className="k-card-title">План / факт</span>
                  </div>
                  <div className="k-bars k-bars--grouped" style={{ height: 96, alignItems: "center", justifyContent: "center" }}>
                    <p className="k-caption">—</p>
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
                    <p className="k-caption" style={{ marginTop: 16 }}>Данные появятся после первых сделок</p>
                  </div>
                )}

                {/* Gap Forecast */}
                <div className="k-card k-card--glass" id="finances">
                  <div className="k-card-head">
                    <span className="k-card-title">Gap Forecast</span>
                  </div>
                  <p className="k-caption" style={{ marginTop: 16 }}>Данные появятся после загрузки банковской выписки</p>
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

      {/* ── Плавающая кнопка голосового ввода ───────────────────────── */}
      <button
        type="button"
        aria-label="Голосовой ввод"
        onClick={() => setVoiceOpen(true)}
        style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 50,
          width: 52, height: 52, borderRadius: "50%", border: "none",
          background: "linear-gradient(135deg,#C89A34,#E4C260)",
          color: "#fff", fontSize: 22, cursor: "pointer",
          boxShadow: "0 4px 16px rgba(200,154,52,.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        🎤
      </button>

      {/* ── Оверлей голосового ввода ─────────────────────────────────── */}
      {voiceOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Голосовой ввод"
          onClick={(e) => { if (e.target === e.currentTarget) setVoiceOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{
            background: "#FEFCF6", borderRadius: 16, padding: "28px 32px",
            boxShadow: "0 12px 40px rgba(0,0,0,.25)", minWidth: 300, position: "relative",
          }}>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setVoiceOpen(false)}
              style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" }}
            >
              ×
            </button>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1A1814" }}>Голосовой ввод</h3>
            <VoiceInput
              businessId={bid}
              onResult={(result) => {
                console.log("[VoiceInput] result:", result);
                setVoiceOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
