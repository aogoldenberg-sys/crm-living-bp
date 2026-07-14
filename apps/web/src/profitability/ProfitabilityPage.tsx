import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { apiFetch, PaywallError } from "../services/apiFetch.js";
import { PaywallScreen } from "../services/PaywallScreen.js";
import type { UnitEconomicsResult } from "@crm/core";

type ApiResult = UnitEconomicsResult & { eventsCount: number };

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "paywall"; err: PaywallError }
  | { kind: "error"; msg: string }
  | { kind: "done"; data: ApiResult };

const HEALTH_COLOR: Record<string, string> = {
  healthy:           "#2E7D32",
  warning:           "#E65100",
  critical:          "#C62828",
  insufficient_data: "#777",
};

const VERDICT_TEXT: Record<string, string> = {
  healthy:           "Юнит сходится. Бизнес зарабатывает на каждом клиенте.",
  warning:           "Юнит на грани. Смотрите слабое место ниже.",
  critical:          "Юнит не сходится. Каждый новый клиент увеличивает убыток.",
  insufficient_data: "Данных недостаточно для вердикта.",
};

function fmtRub(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

interface MetricCardProps {
  label: string;
  value: string | null;
  nullLabel?: string;
}

function MetricCard({ label, value, nullLabel }: MetricCardProps) {
  return (
    <div style={{ padding: "14px 18px", background: "rgba(200,154,52,.06)", border: "1px solid rgba(200,154,52,.2)", borderRadius: 10, minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "#8B7355", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      {value !== null
        ? <div style={{ fontSize: 22, fontWeight: 700, color: "#1A1814" }}>{value}</div>
        : <>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#bbb" }}>—</div>
            {nullLabel && <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{nullLabel}</div>}
          </>
      }
    </div>
  );
}

interface WeakSpotProps {
  data: ApiResult;
}

function WeakSpot({ data }: WeakSpotProps) {
  if (data.health !== "warning" && data.health !== "critical") return null;

  let actual = "";
  let threshold = "";
  let metricLabel = "";

  if (data.marginPercent < 0.20) {
    metricLabel = "Маржа";
    actual = fmtPct(data.marginPercent);
    threshold = "20%";
  } else if (data.roi < 1.0) {
    metricLabel = "ROI";
    actual = data.roi.toFixed(2);
    threshold = "1.0";
  } else if (data.ltvCacRatio !== null && data.ltvCacRatio < 3.0) {
    metricLabel = "LTV/CAC";
    actual = data.ltvCacRatio.toFixed(2);
    threshold = "3.0";
  } else {
    return null;
  }

  return (
    <div style={{ padding: "14px 18px", background: "rgba(198,40,40,.06)", border: "1px solid rgba(198,40,40,.2)", borderRadius: 10, marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#C62828", marginBottom: 8 }}>Слабое место</div>
      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "#888" }}>{metricLabel} — факт</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#C62828" }}>{actual}</div>
        </div>
        <div style={{ fontSize: 18, color: "#ccc" }}>vs</div>
        <div>
          <div style={{ fontSize: 11, color: "#888" }}>Порог</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2E7D32" }}>{threshold}</div>
        </div>
      </div>
    </div>
  );
}

export function ProfitabilityPage() {
  const { user, businessId } = useAuth();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!user || !businessId) return;
    setState({ kind: "loading" });

    user.getIdToken()
      .then(token =>
        apiFetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/unit-economics`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then(res => res.json() as Promise<ApiResult>)
      .then(data => setState({ kind: "done", data }))
      .catch(e => {
        if (e instanceof PaywallError) { setState({ kind: "paywall", err: e }); return; }
        setState({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
      });
  }, [user, businessId]);

  if (state.kind === "paywall") {
    return (
      <PaywallScreen
        reason={state.err.reason}
        requiredTier={state.err.requiredTier}
        requiredProduct={state.err.requiredProduct}
        onClose={() => setState({ kind: "idle" })}
      />
    );
  }

  if (state.kind === "idle" || state.kind === "loading") {
    return <div style={{ padding: 32, color: "#888", fontSize: 14 }}>{state.kind === "loading" ? "Загружаем данные…" : ""}</div>;
  }

  if (state.kind === "error") {
    return <div style={{ padding: 32, color: "#C62828", fontSize: 14 }}>Ошибка: {state.msg}</div>;
  }

  const { data } = state;
  const healthColor = HEALTH_COLOR[data.health] ?? "#777";

  if (data.health === "insufficient_data") {
    return (
      <div style={{ padding: "24px 0" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: healthColor, marginBottom: 20 }}>
          {VERDICT_TEXT.insufficient_data}
        </div>
        <div style={{ padding: "20px 24px", background: "rgba(0,0,0,.04)", borderRadius: 10, fontSize: 14, color: "#555", lineHeight: 1.6 }}>
          Нужно минимум 10 событий. Сейчас: {data.eventsCount}.
          Подключите банк или загрузите выписку.
        </div>
        <div style={{ marginTop: 16 }}>
          <a
            href="/crm_life/intake"
            style={{ display: "inline-block", padding: "10px 22px", background: "linear-gradient(135deg,#C89A34,#E4C260)", borderRadius: 8, fontWeight: 700, fontSize: 13, color: "#3A2800", textDecoration: "none" }}
          >
            Загрузить выписку →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Вердикт */}
      <div style={{ fontSize: 20, fontWeight: 700, color: healthColor, marginBottom: 24 }}>
        {VERDICT_TEXT[data.health] ?? ""}
      </div>

      {/* Метрики */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <MetricCard
          label="Маржа"
          value={`${fmtPct(data.marginPercent)} · ${fmtRub(data.marginKopecks)}`}
        />
        <MetricCard label="ROI" value={data.roi.toFixed(2)} />
        <MetricCard
          label="Окупаемость"
          value={data.paybackMonths !== null ? `${Math.round(data.paybackMonths)} мес.` : null}
          nullLabel="нет данных о CAC или марже"
        />
        <MetricCard
          label="CAC"
          value={data.cacKopecks !== null ? fmtRub(data.cacKopecks) : null}
          nullLabel="нет данных о новых клиентах"
        />
        <MetricCard
          label="LTV"
          value={data.ltvKopecks !== null ? fmtRub(data.ltvKopecks) : null}
          nullLabel="нет данных о выручке"
        />
        <MetricCard
          label="LTV/CAC"
          value={data.ltvCacRatio !== null ? data.ltvCacRatio.toFixed(2) : null}
          nullLabel="нет данных о LTV или CAC"
        />
      </div>

      {/* Слабое место */}
      <WeakSpot data={data} />

      {/* Подвал */}
      <div style={{ marginTop: 24, fontSize: 12, color: "#aaa" }}>
        Расчёт по {data.eventsCount} событиям за {Math.round(data.dataWindowMonths)} месяцев
      </div>
    </div>
  );
}
