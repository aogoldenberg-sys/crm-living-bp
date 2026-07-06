import type { ComplianceCase } from "@crm/schemas";
import "./ComplianceFlow.css";

interface Props {
  caseData: ComplianceCase;
}

export function DoneView({ caseData: _caseData }: Props) {
  return (
    <div className="compliance-done">
      <span className="compliance-done-icon">✅</span>
      <h2 className="compliance-done-title">Пакет готов</h2>
      <p className="compliance-done-sub">
        Документы сформированы. Проверьте письмо и передайте юристу перед отправкой.
      </p>
    </div>
  );
}
