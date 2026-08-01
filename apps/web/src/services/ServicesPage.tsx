import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ComplianceFlow } from "../features/compliance/ComplianceFlow";
import { TaxReportingScreen } from "../features/reporting/TaxReportingScreen";
import { useEntitlements } from "./useEntitlements";
import { PaywallScreen } from "./PaywallScreen";
import "./ServicesPage.css";

type ServiceTab = "tax" | "compliance";

function GatedCompliance({
  businessId, onUsed,
}: { businessId: string; onUsed: () => Promise<void> }) {
  useEffect(() => { void onUsed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <ComplianceFlow businessId={businessId} />;
}

function GatedTax({
  businessId, onUsed,
}: { businessId: string; onUsed: () => Promise<void> }) {
  useEffect(() => { void onUsed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <TaxReportingScreen businessId={businessId} />;
}

export function ServicesPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "compliance") as ServiceTab;
  const [tab, setTab] = useState<ServiceTab>(initialTab);
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
      <header className="svc-header">
        <a href="/" className="svc-brand" target="_blank" rel="noopener noreferrer">
          <img src={import.meta.env.BASE_URL + "logo-badge.png"} alt="Kairos"
            className="svc-logo svc-logo--transparent" />
          <span className="svc-wordmark">Kairos</span>
        </a>
        <nav className="svc-tabs">
          {tabBtn("compliance", "Требование / Запрос")}
          {tabBtn("tax", "Составить отчётность")}
        </nav>
      </header>

      {/* Quick-action cards */}
      <div className="svc-cards">
        <button type="button" className="svc-card" onClick={() => navigate("/onboarding")}>
          Создать бизнес-план
        </button>
        <button type="button" className="svc-card" onClick={() => navigate("/onboarding")}>
          Оценить бизнес-план
        </button>
        <button type="button" className="svc-card" onClick={() => navigate("/business")}>
          Анализ текущего бизнеса
        </button>
      </div>

      <main className="svc-content">
        {tab === "compliance" && (
          canCompliance
            ? <GatedCompliance businessId={businessId ?? ""} onUsed={markComplianceUsed} />
            : <PaywallScreen feature="compliance" onBack={() => setTab("tax")} />
        )}

        {tab === "tax" && (
          canReport
            ? <GatedTax businessId={businessId ?? ""} onUsed={markReportUsed} />
            : <PaywallScreen feature="report" onBack={() => setTab("compliance")} />
        )}
      </main>
    </div>
  );
}
