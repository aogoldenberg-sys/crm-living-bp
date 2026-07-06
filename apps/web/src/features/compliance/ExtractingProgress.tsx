import "./ComplianceFlow.css";

export function ExtractingProgress() {
  return (
    <div className="compliance-extracting">
      <div className="compliance-spinner" />
      <p className="compliance-extracting-title">Анализируем требование...</p>
      <p className="compliance-extracting-sub">Claude разбирает пункты запроса</p>
    </div>
  );
}
