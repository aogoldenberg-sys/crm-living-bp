import { useNavigate } from "react-router-dom";
import type { ComplianceCase } from "@crm/schemas";
import { useAuth } from "../../auth/useAuth";
import "./ComplianceFlow.css";

interface Props {
  caseData: ComplianceCase;
  onChange: (updated: ComplianceCase) => void;
  onNewCase?: () => void;
  onLogout?: () => void;
}

export function DoneView({ caseData, onChange, onNewCase, onLogout }: Props) {
  const navigate = useNavigate();
  const authUser = useAuth((s) => s.user);
  const userLabel = authUser?.displayName || authUser?.email || null;

  const analysis = caseData.response?.letterDraft ?? "";

  function handleCopy() {
    void navigator.clipboard.writeText(analysis);
  }

  function handlePrint() {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Анализ документа — Kairos</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 14px; padding: 40px; line-height: 1.7; }
        h1 { font-size: 18px; margin-bottom: 24px; }
        p { white-space: pre-wrap; margin: 0; }
      </style></head><body>
      <h1>Анализ документа</h1>
      <p>${analysis.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="compliance-done">
      {userLabel && (
        <div style={{ alignSelf: "flex-end", fontSize: 12, color: "#8B7355", background: "rgba(200,160,60,0.1)", borderRadius: 20, padding: "3px 10px", marginBottom: 4 }}>
          👤 {userLabel}
        </div>
      )}

      <span className="compliance-done-icon">✅</span>
      <h2 className="compliance-done-title">Анализ готов</h2>
      <p className="compliance-done-sub">
        Изучите разбор ниже. При необходимости передайте юристу.
      </p>

      <div style={{
        alignSelf: "stretch",
        background: "rgba(200,160,60,0.05)",
        border: "1px solid rgba(200,160,60,0.2)",
        borderRadius: 12,
        padding: "20px 24px",
        fontSize: 14,
        lineHeight: 1.75,
        color: "#1A1814",
        whiteSpace: "pre-wrap",
        maxHeight: 480,
        overflowY: "auto",
      }}>
        {analysis || "Анализ недоступен"}
      </div>

      <div className="compliance-disclaimer" style={{ alignSelf: "stretch", marginTop: 12 }}>
        ⚠️ Это информационный разбор, не юридическая консультация. Перед принятием решений проконсультируйтесь с юристом.
      </div>

      <div className="compliance-done-actions">
        <button type="button" className="compliance-done-btn" onClick={handleCopy}>
          Копировать текст
        </button>
        <button type="button" className="compliance-done-btn compliance-done-btn--secondary" onClick={handlePrint}>
          Печать
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16, width: "100%", flexWrap: "wrap" }}>
        <button type="button" className="paywall-back" onClick={() => onChange({ ...caseData, status: "checklist_review" })}>
          ← Назад к чек-листу
        </button>
        {onNewCase && (
          <button type="button" className="paywall-back" onClick={onNewCase}>
            + Новый кейс
          </button>
        )}
        <button type="button" className="paywall-back" style={{ marginLeft: "auto" }} onClick={() => navigate("/dashboard")}>
          В кабинет
        </button>
        {onLogout && (
          <button type="button" className="paywall-back" onClick={onLogout}>
            Сменить пользователя
          </button>
        )}
      </div>
    </div>
  );
}
