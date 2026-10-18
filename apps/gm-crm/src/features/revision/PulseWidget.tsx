import type { HealthCheck } from "@crm/core";
import type { BusinessEvent } from "@crm/schemas";
import "./PulseWidget.css";

interface Props {
  hc: HealthCheck;
  events: BusinessEvent[];
  onSectionClick: (sectionId: string) => void;
}

function fmtRub(kop: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kop / 100);
}

export function PulseWidget({ hc, events, onSectionClick }: Props) {
  const cash = events
    .filter(e => e.type === "payment_in" || e.type === "payment_out")
    .reduce((s, e) => s + (e.type === "payment_in" ? e.amount : -e.amount), 0);

  const gap = hc.runway_days !== null && hc.runway_days < 60 ? hc.runway_days : null;
  const flags = hc.red_flags.slice(0, 3);

  return (
    <div className="pulse-widget">
      <div className="pulse-item" onClick={() => onSectionClick("finance")}>
        <p className="pulse-label">Касса</p>
        <p className="pulse-value" style={{ color: cash >= 0 ? "#1A6B32" : "#B91C1C" }}>
          {fmtRub(cash)}
        </p>
      </div>

      <div className="pulse-item" onClick={() => onSectionClick("forecast")}>
        <p className="pulse-label">Runway</p>
        <p className="pulse-value" style={{ color: gap !== null ? "#B91C1C" : "#1A6B32" }}>
          {hc.runway_days !== null ? `${hc.runway_days} дн.` : "—"}
        </p>
        {gap !== null && <p className="pulse-gap">⚠️ Меньше 60 дней</p>}
      </div>

      <div className="pulse-item" onClick={() => onSectionClick("risks")}>
        <p className="pulse-label">Отклонения</p>
        {flags.length === 0
          ? <p className="pulse-value" style={{ color: "#1A6B32" }}>Норма</p>
          : flags.map((f, i) => <p key={i} className="pulse-flag">{f}</p>)
        }
      </div>
    </div>
  );
}
