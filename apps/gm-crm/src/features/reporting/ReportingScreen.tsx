import { useState } from "react";
import { MgmtReports } from "./MgmtReports.js";
import { TaxReportingScreen } from "./TaxReportingScreen.js";

type Tab = "tax" | "mgmt";

interface Props {
  businessId: string;
}

export function ReportingScreen({ businessId }: Props) {
  // РЕШЕНИЕ: taxContent убран, рендерим TaxReportingScreen напрямую — меньше indirection.
  const taxContent = <TaxReportingScreen businessId={businessId} />;
  const [tab, setTab] = useState<Tab>("tax");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 20px",
    border: "none",
    borderBottom: active ? "2px solid #C89A34" : "2px solid transparent",
    background: "transparent",
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? "#1A1814" : "#8B7355",
    cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(200,160,60,0.2)", marginBottom: 24 }}>
        <button style={tabStyle(tab === "tax")} onClick={() => setTab("tax")}>
          Налоговая
        </button>
        <button style={tabStyle(tab === "mgmt")} onClick={() => setTab("mgmt")}>
          Управленческая
        </button>
      </div>

      {tab === "tax" && taxContent}
      {tab === "mgmt" && <MgmtReports businessId={businessId} />}
    </div>
  );
}
