import "./ServicesPage.css";

interface Props {
  feature: "compliance" | "report";
  onBack: () => void;
}

const COPY: Record<Props["feature"], { title: string; desc: string }> = {
  compliance: {
    title: "Ответ на требование — платная функция",
    desc: "Первый ответ на требование бесплатно. Для последующих случаев подключите тариф.",
  },
  report: {
    title: "Отчётность — платная функция",
    desc: "Первый отчёт бесплатно. Для последующих подключите тариф.",
  },
};

export function PaywallScreen({ feature, onBack }: Props) {
  const { title, desc } = COPY[feature];
  return (
    <div className="paywall">
      <div className="paywall-card">
        <span className="paywall-lock">🔒</span>
        <h2 className="paywall-title">{title}</h2>
        <p className="paywall-desc">{desc}</p>
        <div className="paywall-price">
          <span className="paywall-price-label">Тариф «Базовый»</span>
          <span className="paywall-price-amount">990 ₽ / мес</span>
        </div>
        <button
          type="button"
          className="paywall-btn"
          onClick={() => alert("Оплата временно недоступна — обратитесь к менеджеру.")}
        >
          Подключить тариф
        </button>
        <button type="button" className="paywall-back" onClick={onBack}>
          ← Назад
        </button>
      </div>
    </div>
  );
}
