import "./EmptyState.css";

interface Props {
  onNoplan: () => void;
  onUpload: () => void;
}

export function EmptyState({ onNoplan, onUpload }: Props) {

  return (
    <div className="empty-state">
      <div className="empty-state__logo">
        <svg width="40" height="40" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <polygon
            points="14,2 25,8 25,20 14,26 3,20 3,8"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
          <line x1="3" y1="8" x2="25" y2="20" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="empty-state__logo-text">Kairos</span>
      </div>

      <h1 className="empty-state__title">С чего начнём?</h1>
      <p className="empty-state__subtitle">Выберите способ запустить ваш финансовый план</p>

      <div className="empty-state__actions">
        <button className="es-btn es-btn--primary" onClick={onNoplan}>
          У меня нет плана — создать с нуля
        </button>
        <button className="es-btn es-btn--secondary" onClick={onUpload}>
          У меня есть бизнес-план — загрузить
        </button>
      </div>
    </div>
  );
}
