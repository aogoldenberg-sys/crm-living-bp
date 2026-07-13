import { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/useAuth";
import { useIntake } from "../dashboard/useIntake";
import { PaywallScreen } from "../services/PaywallScreen";
import { PlanDiffModal } from "./PlanDiffModal";
import { ScenarioHistory } from "./ScenarioHistory";
import type { ScenarioResult, PlanDiff } from "@crm/schemas";

type PageState = "idle" | "loading" | "done" | "accepted";

interface RunResult {
  status: string;
  results?: ScenarioResult[];
}

const COMPLEXITY_LABEL: Record<string, string> = { low: "Низкая", medium: "Средняя", high: "Высокая" };
const COMPLEXITY_COLOR: Record<string, string> = { low: "#2E7D32", medium: "#E65100", high: "#C62828" };

export function ScenariosPage() {
  const { businessId, user } = useAuth();
  const bid = businessId ?? "";
  const { data: intake } = useIntake(bid);

  const [state, setState] = useState<PageState>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [paywallErr, setPaywallErr] = useState<{ reason?: string; requiredTier?: string } | null>(null);

  const [diffModal, setDiffModal] = useState<{ scenarioId: string; diffs: PlanDiff[] } | null>(null);
  const [acceptLoading, setAcceptLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const planId = intake?.intakeId ?? bid;

  // Polling
  useEffect(() => {
    if (state !== "loading" || !runId) return;

    pollRef.current = setInterval(() => void poll(), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state, runId]);

  async function poll() {
    if (!user || !runId) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${import.meta.env.VITE_INGEST_WORKER_URL as string}/scenarios/${runId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const data = await res.json() as RunResult;
      if (data.status === "done" && data.results) {
        if (pollRef.current) clearInterval(pollRef.current);
        setResults(data.results);
        setState("done");
      }
    } catch { /* игнорируем сетевые ошибки между опросами */ }
  }

  async function simulate() {
    if (!user) return;
    setState("loading"); setErr(null); setPaywallErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/scenarios/simulate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (res.status === 402) {
        const d = await res.json() as { error?: string; requiredTier?: string };
        setPaywallErr({ reason: d.error, requiredTier: d.requiredTier });
        setState("idle");
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      const d = await res.json() as { runId: string };
      setRunId(d.runId);
    } catch (e) {
      setState("idle");
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function requestAccept(scenarioId: string) {
    if (!user) return;
    setAcceptLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/scenarios/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, runId, scenarioId }),
      });
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      // В ответе будет diff — используем его
      const d = await res.json() as { diff: PlanDiff[] };
      setDiffModal({ scenarioId, diffs: d.diff ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка принятия");
    } finally {
      setAcceptLoading(false);
    }
  }

  function confirmAccept() {
    setDiffModal(null);
    setState("accepted");
  }

  if (paywallErr) {
    return (
      <PaywallScreen
        feature="plan_roadmap"
        reason={paywallErr.reason}
        onBack={() => setPaywallErr(null)}
      />
    );
  }

  if (!intake) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center", color: "#888" }}>
        <p style={{ fontSize: 14 }}>Нужны факт-данные, подключите банк</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1A1814" }}>Сценарии</h2>
        {state === "idle" && (
          <button
            type="button"
            onClick={() => void simulate()}
            style={{ fontSize: 12, padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C89A34,#E4C260)", color: "#3A2800", cursor: "pointer", fontWeight: 700 }}
          >
            Просчитать сценарии
          </button>
        )}
        {state === "loading" && (
          <span style={{ fontSize: 12, color: "#C89A34", fontWeight: 600 }}>Просчитываем… (обновление каждые 3 сек)</span>
        )}
        {err && <span style={{ fontSize: 12, color: "#C62828" }}>{err}</span>}
      </div>

      {state === "accepted" && (
        <div style={{ padding: "12px 16px", background: "#D4EDDA", borderRadius: 8, marginBottom: 20, fontSize: 13, color: "#155724", fontWeight: 600 }}>
          Сценарий принят — создана новая версия плана
        </div>
      )}

      {state === "done" && results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
          {results.map(r => (
            <ScenarioCard
              key={r.scenarioId}
              result={r}
              onAccept={() => void requestAccept(r.scenarioId)}
              accepting={acceptLoading}
            />
          ))}
        </div>
      )}

      <ScenarioHistory businessId={bid} />

      {diffModal && (
        <PlanDiffModal
          diffs={diffModal.diffs}
          onConfirm={confirmAccept}
          onCancel={() => setDiffModal(null)}
        />
      )}
    </div>
  );
}

function ScenarioCard({ result, onAccept, accepting }: { result: ScenarioResult; onAccept: () => void; accepting: boolean }) {
  const prob = Math.round(result.gapAvoidedProbability * 100);
  const conf = Math.round(result.projectedForecast.confidence * 100);
  const impact = (result.impactOnGoal / 100).toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

  return (
    <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid rgba(200,154,52,.25)", background: "rgba(200,154,52,.04)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1A1814", marginBottom: 4 }}>
            {result.levers.join(" + ")}
          </div>
          <div style={{ fontSize: 12, color: "#888" }}>
            Разрыв закрывается с вероятностью <b style={{ color: prob >= 70 ? "#2E7D32" : prob >= 40 ? "#E65100" : "#C62828" }}>{prob}%</b>
            {" · "}Уверенность прогноза <b>{conf}%</b>
          </div>
        </div>
        <span style={{
          fontSize: 11, padding: "3px 10px", borderRadius: 10, fontWeight: 700,
          background: "transparent", border: `1px solid ${COMPLEXITY_COLOR[result.complexity] ?? "#999"}`,
          color: COMPLEXITY_COLOR[result.complexity] ?? "#999",
        }}>
          {COMPLEXITY_LABEL[result.complexity] ?? result.complexity}
        </span>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>Влияние на цель</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: result.impactOnGoal >= 0 ? "#2E7D32" : "#C62828" }}>{impact}</div>
        </div>
        {result.projectedForecast.gapDate && (
          <div>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>Разрыв</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#C62828" }}>{result.projectedForecast.gapDate}</div>
          </div>
        )}
        {!result.projectedForecast.gapDate && (
          <div>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>Разрыв</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#2E7D32" }}>Не прогнозируется</div>
          </div>
        )}
      </div>

      {result.drivers.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Ключевые драйверы</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {result.drivers.map((d, i) => (
              <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "rgba(200,154,52,.15)", color: "#8B6914" }}>{d}</span>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onAccept}
        disabled={accepting}
        style={{ fontSize: 12, padding: "6px 16px", borderRadius: 8, border: "none", background: "#1A3E1A", color: "#fff", cursor: "pointer", fontWeight: 600 }}
      >
        {accepting ? "…" : "Принять"}
      </button>
    </div>
  );
}
