import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { useAuth } from "../auth/useAuth";
import { ComplianceFlow } from "../features/compliance/ComplianceFlow";
import { TaxReportingScreen } from "../features/reporting/TaxReportingScreen";
import { useEntitlements } from "./useEntitlements";
import { PaywallScreen } from "./PaywallScreen";
import "./ServicesPage.css";

type ServiceTab = "tax" | "compliance";

function hasSavedCase(businessId: string): boolean {
  return !!localStorage.getItem(`kairos_compliance_case_${businessId}`);
}

function GatedTax({
  businessId, onUsed,
}: { businessId: string; onUsed: () => Promise<void> }) {
  useEffect(() => { void onUsed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <TaxReportingScreen businessId={businessId} />;
}

function EmailBanner() {
  const { user } = useAuth();
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (!user || user.emailVerified) return null;
  // Yandex users authenticated via custom token — no email in Firebase Auth
  if (user.uid.startsWith("yandex:")) return null;

  const handleResend = async () => {
    if (countdown > 0) return;
    await sendEmailVerification(user).catch(() => {});
    setCountdown(60);
  };

  return (
    <div className="svc-email-banner">
      <span>Подтвердите email, чтобы разблокировать все функции.</span>
      <button type="button" onClick={handleResend} disabled={countdown > 0}>
        {countdown > 0 ? `Отправить ещё раз (${countdown}с)` : "Отправить письмо"}
      </button>
    </div>
  );
}

export function ServicesPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "compliance") as ServiceTab;
  const [tab, setTab] = useState<ServiceTab>(initialTab);
  const [refreshKey, setRefreshKey] = useState(0);
  const { businessId } = useAuth();
  const navigate = useNavigate();
  const { loading, canCompliance, canReport, markComplianceUsed, markReportUsed } =
    useEntitlements(businessId);

  if (loading) return <div className="loading-screen">Загрузка\u2026</div>;

  const tabBtn = (id: ServiceTab, label: string) => (
    <button
      type="button"
      className={`svc-tab${tab === id ? " svc-tab--active" : ""}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="svc-page">
      <div className="svc-ball svc-ball--1"><img src={import.meta.env.BASE_URL + "ball-gold.png"} alt="" /></div>
      <div className="svc-ball svc-ball--2"><img src={import.meta.env.BASE_URL + "ball-glossy.png"} alt="" /></div>
      <div className="svc-ball svc-ball--3"><img src={import.meta.env.BASE_URL + "ball-gold.png"} alt="" /></div>
      <div className="svc-ball svc-ball--4"><img src={import.meta.env.BASE_URL + "ball-glossy.png"} alt="" /></div>
      <div className="svc-ball svc-ball--5"><img src={import.meta.env.BASE_URL + "ball-gold.png"} alt="" /></div>
      <header className="svc-header">
        <a href="/" className="svc-brand" target="_blank" rel="noopener noreferrer">
          <img src={import.meta.env.BASE_URL + "logo-badge.png"} alt="Kairos"
            className="svc-logo svc-logo--transparent" />
          <span className="svc-wordmark">Kairos</span>
        </a>
        <nav className="svc-tabs">
          {tabBtn("compliance", "Требование / Запрос")}
          {tabBtn("tax", "Составить отчётность")}
          <button type="button" className="svc-tab" onClick={() => navigate("/onboarding")}>
            Создать бизнес-план
          </button>
          <button type="button" className="svc-tab" onClick={() => navigate("/onboarding")}>
            Оценить бизнес-план
          </button>
          <button type="button" className="svc-tab" onClick={() => navigate("/business")}>
            Анализ текущего бизнеса
          </button>
        </nav>
        <a
          href="https://opentgp.ru/kairos/#pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="svc-tariffs-btn"
        >
          ТАРИФЫ
        </a>
      </header>

      <main className="svc-content">
        {tab === "compliance" && (
          (canCompliance || hasSavedCase(businessId ?? ""))
            ? <ComplianceFlow key={refreshKey} businessId={businessId ?? ""} onCaseCreated={markComplianceUsed} onRequestNewCase={() => {
                localStorage.removeItem(`kairos_compliance_case_${businessId ?? ""}`);
                void markComplianceUsed();
                setRefreshKey(k => k + 1);
              }} />
            : <PaywallScreen feature="compliance" onBack={() => setTab("tax")} />
        )}

        {tab === "tax" && (
          canReport
            ? <GatedTax businessId={businessId ?? ""} onUsed={markReportUsed} />
            : <PaywallScreen feature="report" onBack={() => setTab("compliance")} />
        )}

        <EmailBanner />
      </main>
    </div>
  );
}
