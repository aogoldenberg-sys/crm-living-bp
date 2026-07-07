import "./EmptyState.css";

interface Props {
  onBusiness: () => void;   // «Бизнес работает»
  onReporting: () => void;  // «Подготовить отчётность»
  onCompliance: () => void; // «Ответить на требование налоговой»
}

export function EmptyState({ onBusiness, onReporting, onCompliance }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state__logo">
        <img
          src={import.meta.env.BASE_URL + "logo-badge.png"}
          alt="Kairos"
          className="empty-state__logo-img"
        />
        <span className="empty-state__logo-text">Kairos</span>
      </div>

      <h1 className="empty-state__title">С чего начнём?</h1>

      <div className="empty-state__actions">
        <button className="es-btn es-btn--primary" onClick={onBusiness}>
          Бизнес работает
        </button>
        <button className="es-btn es-btn--secondary" onClick={onReporting}>
          Подготовить отчётность
        </button>
        <button className="es-btn es-btn--secondary" onClick={onCompliance}>
          Ответить на требование налоговой
        </button>
      </div>
    </div>
  );
}
