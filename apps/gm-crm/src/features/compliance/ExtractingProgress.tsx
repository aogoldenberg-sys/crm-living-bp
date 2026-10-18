import "./ComplianceFlow.css";

interface Props {
  stage?: "extracting" | "assembling";
  onCancel?: () => void;
}

export function ExtractingProgress({ stage = "extracting", onCancel }: Props) {
  const title = stage === "assembling"
    ? "Собираем пакет документов…"
    : "Анализируем требование…";
  const sub = stage === "assembling"
    ? "Kairos готовит мотивированный ответ"
    : "Kairos разбирает пункты запроса";

  return (
    <div className="compliance-extracting">
      <div className="compliance-spinner" />
      <p className="compliance-extracting-title">{title}</p>
      <p className="compliance-extracting-sub">{sub}</p>
      {onCancel && (
        <button type="button" className="paywall-back" style={{ marginTop: 24 }} onClick={onCancel}>
          ← Назад к чек-листу
        </button>
      )}
    </div>
  );
}
