import { useAutonomyJournal } from "./useAutonomyJournal";
import "./panels.css";

const LEVEL_LABELS: Record<string, string> = {
  A1: "A1 — Наблюдатель",
  A2: "A2 — Оператор",
  A3: "A3 — Советник",
  A4: "A4 — Стратег",
};

const VERDICT_LABELS: Record<string, { label: string; cls: string }> = {
  execute: { label: "Выполнено", cls: "verdict--execute" },
  ask_human: { label: "Запрос к человеку", cls: "verdict--human" },
  insufficient_data: { label: "Нет данных", cls: "verdict--nodata" },
};

interface Props {
  businessId: string;
}

export function AutonomyPanel({ businessId }: Props) {
  const { journal, config } = useAutonomyJournal(businessId);

  return (
    <div className="panel-autonomy">
      <h2 className="panel-title">Автономия</h2>

      {/* Текущий уровень */}
      <section className="panel-section panel-section--inline">
        <h3 className="panel-section-title">Текущий уровень</h3>
        {config ? (
          <div className="autonomy-level-badge">
            {LEVEL_LABELS[config.level] ?? config.level}
          </div>
        ) : (
          <p className="panel-no-items">Уровень не настроен</p>
        )}
      </section>

      {/* Журнал решений */}
      <section className="panel-section">
        <h3 className="panel-section-title">
          Журнал решений
          <span className="panel-count panel-count--neutral">{journal.length}</span>
        </h3>
        {journal.length === 0 ? (
          <div className="panel-empty panel-empty--inline">
            <span className="panel-empty-icon">○</span>
            <p className="panel-empty-text">Решений пока не принималось</p>
          </div>
        ) : (
          <ul className="panel-list journal-list">
            {journal.map((row) => {
              const v = VERDICT_LABELS[row.verdict] ?? { label: row.verdict, cls: "" };
              const dt = row.decidedAt
                ? new Date(row.decidedAt).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—";
              return (
                <li key={row.entryId || row.actionId} className="journal-row">
                  <div className="journal-row-top">
                    <span className={`journal-verdict ${v.cls}`}>{v.label}</span>
                    <span className="journal-dt">{dt}</span>
                  </div>
                  <p className="journal-reason">{row.reason}</p>
                  <div className="journal-meta">
                    <span>Уровень: {row.configuredLevel}</span>
                    <span>Требуется: {row.requiredLevel}</span>
                    {row.applied && <span className="journal-applied">применено</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
