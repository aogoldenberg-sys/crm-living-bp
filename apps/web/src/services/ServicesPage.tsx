import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ComplianceFlow } from "../features/compliance/ComplianceFlow";
import { TaxReportingScreen } from "../features/reporting/TaxReportingScreen";
import { useEntitlements } from "./useEntitlements";
import { PaywallScreen } from "./PaywallScreen";
import "./ServicesPage.css";

type ServiceTab = "tax" | "compliance";

/** Рендерит ComplianceFlow и помечает entitlement использованным при первом входе */
function GatedCompliance({
  businessId,
  onUsed,
}: { businessId: string; onUsed: () => Promise<void> }) {
  useEffect(() => { void onUsed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <ComplianceFlow businessId={businessId} />;
}

/** Рендерит TaxReportingScreen и помечает entitlement использованным при первом входе */
function GatedTax({
  businessId,
  onUsed,
}: { businessId: string; onUsed: () => Promise<void> }) {
  useEffect(() => { void onUsed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <TaxReportingScreen businessId={businessId} />;
}

export function ServicesPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "compliance") as ServiceTab;
  const [tab, setTab] = useState<ServiceTab>(initialTab);
  const { businessId } = useAuth();
  const { loading, canCompliance, canReport, markComplianceUsed, markReportUsed } =
    useEntitlements(businessId);

  if (loading) return <div className="loading-screen">Загрузка…</div>;

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
        <Link to="/" className="svc-brand">
          <img src={import.meta.env.BASE_URL + "logo-badge.png"} alt="Kairos" className="svc-logo" />
          <span className="svc-wordmark">Kairos</span>
        </Link>
        <nav className="svc-tabs">
          {tabBtn("compliance", "Требование налоговой")}
          {tabBtn("tax", "Отчётность")}
        </nav>
        <Link to="/dashboard" className="svc-dashboard-link">
          Дашборд →
        </Link>
      </header>

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
