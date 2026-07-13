import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { SUBSCRIPTIONS, TG_MANAGER } from "./pricing";
import "./ServicesPage.css";

interface Props {
  feature: "compliance" | "report" | "plan_assess" | "plan_reform" | "plan_roadmap" | "grant_adapt";
  reason?: string;
  requiredTier?: string;
  onBack: () => void;
}

const COPY: Record<Props["feature"], { title: string; desc: string }> = {
  compliance:    { title: "Ответ на требование", desc: "Первый кейс бесплатно. Для последующих нужен тариф «Пульс» или выше." },
  report:        { title: "Отчётность",          desc: "Первый отчёт бесплатно. Для последующих нужен тариф «Пульс» или выше." },
  plan_assess:   { title: "Оценка плана (Kairos)", desc: "Купите «Диагностика» или активируйте триал." },
  plan_reform:   { title: "Исправление плана",   desc: "Требуется «Живой план» или подписка «Операционист»." },
  plan_roadmap:  { title: "Дорожная карта",       desc: "Требуется «Сценарий» или подписка «Операционист»." },
  grant_adapt:   { title: "Адаптация под грант",  desc: "Требуется «Под субсидию» или подписка «Операционист»." },
};

export function PaywallScreen({ feature, reason, onBack }: Props) {
  const { user } = useAuth();
  const { title, desc } = COPY[feature];
  const [trialStatus, setTrialStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [trialErr, setTrialErr] = useState<string | null>(null);

  const suggestedSub = SUBSCRIPTIONS.find(s => s.id === "pulse") ?? SUBSCRIPTIONS[0];

  async function startTrial() {
    if (!user) return;
    setTrialStatus("loading"); setTrialErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_INGEST_WORKER_URL as string}/billing/start-trial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "pulse" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      setTrialStatus("done");
    } catch (e) {
      setTrialStatus("error");
      setTrialErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div className="paywall">
      <div className="paywall-card">
        <span className="paywall-lock">🔒</span>
        <h2 className="paywall-title">{title}</h2>
        <p className="paywall-desc">{reason ?? desc}</p>

        {trialStatus === "done" ? (
          <p style={{ color: "#2e7d32", fontWeight: 600, margin: "16px 0" }}>
            Триал активирован — перезагрузите страницу.
          </p>
        ) : (
          <>
            <div className="paywall-price">
              <span className="paywall-price-label">Тариф «{suggestedSub.name}»</span>
              <span className="paywall-price-amount">{suggestedSub.price}</span>
            </div>
            <button
              type="button"
              className="paywall-btn"
              disabled={trialStatus === "loading"}
              onClick={() => void startTrial()}
            >
              {trialStatus === "loading" ? "Активируем…" : "Начать триал 14 дней"}
            </button>
            {trialErr && <p style={{ color: "#c62828", fontSize: 12, margin: "8px 0 0" }}>{trialErr}</p>}
            <a
              href={TG_MANAGER}
              target="_blank"
              rel="noopener noreferrer"
              className="paywall-btn"
              style={{ display: "block", textAlign: "center", marginTop: 8, background: "#e3f2fd", color: "#0d47a1", textDecoration: "none" }}
            >
              Связаться с менеджером
            </a>
          </>
        )}

        <button type="button" className="paywall-back" onClick={onBack}>
          ← Назад
        </button>
      </div>
    </div>
  );
}
