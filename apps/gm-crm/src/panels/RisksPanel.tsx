import type { Assessment } from "../dashboard/useIntake";
import "./panels.css";

interface Props {
  assessment: Assessment | null;
}

export function RisksPanel({ assessment }: Props) {
  if (!assessment) {
    return (
      <div className="panel-empty">
        <span className="panel-empty-icon">○</span>
        <p className="panel-empty-text">Загрузите бизнес-план — появится оценка рисков</p>
      </div>
    );
  }

  const { concerns, strengths } = assessment;

  return (
    <div className="panel-risks">
      <h2 className="panel-title">Риски и сильные стороны</h2>

      {/* ── Риски ── */}
      <section className="panel-section">
        <h3 className="panel-section-title">
          Риски
          <span className="panel-count panel-count--risk">{concerns.length}</span>
        </h3>
        {concerns.length === 0 ? (
          <p className="panel-no-items">Явных рисков не выявлено</p>
        ) : (
          <ul className="panel-list">
            {concerns.map((c, i) => (
              <li key={i} className={`panel-list-item panel-list-item--${c.severity}`}>
                <span className={`panel-severity-dot panel-severity-dot--${c.severity}`} />
                <div className="panel-item-body">
                  <p className="panel-item-title">{c.description}</p>
                  {c.rationale && <p className="panel-item-sub">{c.rationale}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Сильные стороны ── */}
      <section className="panel-section">
        <h3 className="panel-section-title">
          Сильные стороны
          <span className="panel-count panel-count--strength">{strengths.length}</span>
        </h3>
        {strengths.length === 0 ? (
          <p className="panel-no-items">Не определены</p>
        ) : (
          <ul className="panel-list">
            {strengths.map((s, i) => (
              <li key={i} className="panel-list-item panel-list-item--strength">
                <span className="panel-strength-check">✓</span>
                <p className="panel-item-title">{s}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
