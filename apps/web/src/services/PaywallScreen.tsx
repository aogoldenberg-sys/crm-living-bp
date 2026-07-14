import { useState, useEffect } from "react";
import { useAuth } from "../auth/useAuth";
import { CONTACT_URL } from "./pricing";
import { priceForPaywall, tierLabel } from "./paywallHelpers";
import "./ServicesPage.css";

export interface PaywallScreenProps {
  reason: string;
  requiredTier?: string;
  requiredProduct?: string;
  onClose: () => void;
  onRetry?: () => void;
}

interface BillingState {
  trialEndsAt: string | null;
}


export function PaywallScreen({
  reason,
  requiredTier,
  requiredProduct,
  onClose,
  onRetry,
}: PaywallScreenProps) {
  const { user, businessId } = useAuth();

  const [trialEndsAt, setTrialEndsAt] = useState<string | null | undefined>(undefined);
  const [trialStatus, setTrialStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [trialErr, setTrialErr] = useState<string | null>(null);

  const price = priceForPaywall(requiredTier, requiredProduct);
  const label = tierLabel(requiredTier, requiredProduct);
  const tier = requiredTier ?? "pulse";

  // Проверяем статус триала при маунте
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void user.getIdToken().then(async token => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_INGEST_WORKER_URL as string}/billing/state`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok || cancelled) return;
        const d = await res.json() as BillingState;
        if (!cancelled) setTrialEndsAt(d.trialEndsAt);
      } catch {
        if (!cancelled) setTrialEndsAt(null); // при ошибке показываем кнопку триала
      }
    });
    return () => { cancelled = true; };
  }, [user]);

  async function startTrial() {
    if (!user) return;
    setTrialStatus("loading"); setTrialErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${import.meta.env.VITE_INGEST_WORKER_URL as string}/billing/start-trial`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Ошибка ${res.status}`);
      }
      // Обновляем billing state чтобы скрыть кнопку
      const stateRes = await fetch(
        `${import.meta.env.VITE_INGEST_WORKER_URL as string}/billing/state`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).catch(() => null);
      if (stateRes?.ok) {
        const d = await stateRes.json() as BillingState;
        setTrialEndsAt(d.trialEndsAt);
      }
      setTrialStatus("done");
      onClose();
      onRetry?.();
    } catch (e) {
      setTrialStatus("error");
      setTrialErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  function openPayLink() {
    const params = new URLSearchParams({
      start: `Тариф ${tier} businessId ${businessId ?? ""}`,
    });
    window.open(`${CONTACT_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="paywall">
      <div className="paywall-card">
        <span className="paywall-lock">🔒</span>
        <h2 className="paywall-title">Требуется подписка</h2>
        <p className="paywall-desc">{reason}</p>

        <div className="paywall-price">
          <span className="paywall-price-label">Тариф «{label}»</span>
          <span className="paywall-price-amount">{price}</span>
        </div>

        {/* а) Триал — только если trialEndsAt === null (не использован) */}
        {trialEndsAt === null && (
          <button
            type="button"
            className="paywall-btn"
            disabled={trialStatus === "loading"}
            onClick={() => void startTrial()}
          >
            {trialStatus === "loading" ? "Активируем…" : "Начать бесплатно на 14 дней"}
          </button>
        )}
        {trialErr && (
          <p style={{ color: "#c62828", fontSize: 12, margin: "4px 0 0" }}>{trialErr}</p>
        )}

        {/* б) Оплатить */}
        <button
          type="button"
          className="paywall-btn"
          style={{ marginTop: 8, background: "#e3f2fd", color: "#0d47a1" }}
          onClick={openPayLink}
        >
          Оплатить
        </button>

        {/* в) Все тарифы */}
        <a
          href="/crm_life/services"
          className="paywall-btn"
          style={{ display: "block", textAlign: "center", marginTop: 8, background: "transparent", color: "#8B6914", border: "1px solid #C89A34", textDecoration: "none" }}
        >
          Все тарифы
        </a>

        <button type="button" className="paywall-back" onClick={onClose}>
          ← Назад
        </button>
      </div>
    </div>
  );
}
