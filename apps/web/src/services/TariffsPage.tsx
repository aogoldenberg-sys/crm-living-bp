import { ONE_OFF, SUBSCRIPTIONS, MAGNETS, TG_MANAGER } from "./pricing";

export function TariffsPage() {
  return (
    <div style={{ padding: "24px 16px", maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 8 }}>Тарифы Kairos</h2>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Разовые услуги по бизнес-плану</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={TH}>Продукт</th>
              <th style={TH}>Стоимость</th>
              <th style={TH}>Включает</th>
            </tr>
          </thead>
          <tbody>
            {ONE_OFF.map(p => (
              <tr key={p.id}>
                <td style={TD}><strong>{p.name}</strong></td>
                <td style={TD}>{p.price}</td>
                <td style={TD}>{p.includes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Подписка «AI-исполнительный директор»</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={TH}>Тариф</th>
              <th style={TH}>Цена</th>
              <th style={TH}>Ценность</th>
            </tr>
          </thead>
          <tbody>
            {SUBSCRIPTIONS.map(s => (
              <tr key={s.id}>
                <td style={TD}><strong>{s.name}</strong></td>
                <td style={{ ...TD, whiteSpace: "nowrap" }}>{s.price}</td>
                <td style={TD}>{s.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Триал 14 дней — без карты, на любом тарифе подписки.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Сервисы-магниты</h3>
        {MAGNETS.map(m => (
          <div key={m.name} style={{ marginBottom: 8, fontSize: 13 }}>
            <strong>{m.name}</strong> — {m.price}. <span style={{ color: "#666" }}>{m.note}</span>
          </div>
        ))}
      </section>

      <a
        href={TG_MANAGER}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "inline-block", padding: "10px 24px", background: "#0d47a1", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 14 }}
      >
        Связаться с менеджером
      </a>
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e0e0e0", fontWeight: 600 };
const TD: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" };
