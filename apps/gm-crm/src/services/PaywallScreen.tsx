import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ONE_OFF, SUBSCRIPTIONS, PRICING_URL, CONTACT_URL } from "./pricing";
import "./ServicesPage.css";

export interface PaywallScreenProps {
  /** Какой продукт заблокирован: id из ONE_OFF или SUBSCRIPTIONS */
  feature?: string;
  onBack?: () => void;
  /** Legacy props — backward compat */
  reason?: string;
  requiredTier?: string;
  requiredProduct?: string;
  internal?: boolean;
  onClose?: () => void;
  onRetry?: () => void;
}

/** Резолвит продукт/тариф по feature id */
function resolve(feature: string) {
  const product = ONE_OFF.find(p => p.id === feature);
  if (product) return { name: product.name, price: product.price, freeFirst: product.freeFirst };
  const sub = SUBSCRIPTIONS.find(s => s.id === feature);
  if (sub) return { name: sub.name, price: sub.price, freeFirst: undefined };
  if (feature === "report") {
    const kudir = ONE_OFF.find(p => p.id === "kudir");
    if (kudir) return { name: kudir.name, price: kudir.price, freeFirst: kudir.freeFirst };
  }
  return { name: "Kairos", price: "", freeFirst: undefined };
}

export function PaywallScreen(props: PaywallScreenProps) {
  const { businessId } = useAuth();
  const navigate = useNavigate();

  if (props.internal === true) return null;

  // Resolve feature from either new or legacy props
  const featureId = props.feature ?? props.requiredProduct ?? props.requiredTier ?? "pulse";
  const goBack = () => navigate("/dashboard");
  const { name, price, freeFirst } = resolve(featureId);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function openPayLink() {
    setPaying(true);
    setPayStatus(null);
    try {
      const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
      const res = await fetch(`${workerUrl}/billing/pay?product=${featureId}&businessId=${businessId ?? ""}`);
      const data = await res.json() as { success?: boolean; paymentUrl?: string; fallback?: boolean; message?: string; error?: string };
      if (data.success && data.paymentUrl) {
        window.open(data.paymentUrl, "_blank", "noopener,noreferrer");
      } else {
        setPayStatus(data.message ?? data.error ?? "Ошибка оплаты");
      }
    } catch {
      setPayStatus("Не удалось связаться с сервером оплаты");
    } finally {
      setPaying(false);
    }
  }

  function openTelegram() {
    const params = new URLSearchParams({ start: `${name} businessId ${businessId ?? ""}` });
    window.open(`${CONTACT_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="paywall">
      <div className="paywall-card">
        <span className="paywall-lock">🔒</span>
        <h2 className="paywall-title">Бесплатный лимит исчерпан</h2>
        <p className="paywall-desc">
          {freeFirst
            ? `${freeFirst}. Для следующих — оплата.`
            : `Для доступа к «${name}» необходима оплата.`}
        </p>

        <div className="paywall-price">
          <span className="paywall-price-label">Тариф «{name}»</span>
          <span className="paywall-price-amount">{price}</span>
        </div>

        {/* Оплатить через Т-Банк */}
        <button
          type="button"
          className="paywall-btn"
          onClick={openPayLink}
          disabled={paying}
        >
          {paying ? "Подключение…" : `Оплатить ${price}`}
        </button>
        {payStatus && <p style={{ fontSize: 13, color: "#8B4513", margin: 0 }}>{payStatus}</p>}

        {/* Техподдержка в Telegram */}
        <button
          type="button"
          className="paywall-btn"
          style={{ marginTop: 8, background: "#6B4226", color: "#fff" }}
          onClick={openTelegram}
        >
          Техподдержка
        </button>

        {/* Все тарифы */}
        <a
          href={PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="paywall-btn"
          style={{ display: "block", textAlign: "center", marginTop: 8, background: "transparent", color: "#8B6914", border: "1px solid #C89A34", textDecoration: "none" }}
        >
          Все тарифы
        </a>

        <button type="button" className="paywall-back" onClick={goBack}>
          ← Назад
        </button>
      </div>
    </div>
  );
}
