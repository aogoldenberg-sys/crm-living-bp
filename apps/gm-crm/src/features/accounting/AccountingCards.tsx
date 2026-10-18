import { buildAccountingCards } from "@crm/core";
import { useBusinessEvents } from "../reporting/useBusinessEvents";
import { useAuth } from "../../auth/useAuth";
import "./AccountingCards.css";

export function AccountingCards() {
  const { businessId } = useAuth();
  const { data: events = [] } = useBusinessEvents(businessId ?? "");
  const cards = buildAccountingCards(events);

  if (cards.length === 0) {
    return <div className="ac-empty">Загрузите выписки для формирования карточек</div>;
  }

  return (
    <div className="ac-grid">
      {cards.map(c => (
        <div key={c.period} className="ac-card">
          <div className="ac-period">{c.period}</div>
          <div className="ac-row"><span>Выручка</span><span className="ac-val--in">{fmtRub(c.revenue)}</span></div>
          <div className="ac-row"><span>Расходы</span><span className="ac-val--out">{fmtRub(c.expenses)}</span></div>
          <div className="ac-divider" />
          <div className="ac-row ac-row--profit"><span>Прибыль</span><span className={c.profit >= 0 ? "ac-val--pos" : "ac-val--neg"}>{fmtRub(c.profit)}</span></div>
        </div>
      ))}
    </div>
  );
}

function fmtRub(kop: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kop / 100);
}
