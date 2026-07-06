/**
 * Управленческая отчётность — заглушка.
 * Реальные данные подключатся когда будут события в Firestore.
 */
export function MgmtReports() {
  const cards = [
    { title: "П&Л", subtitle: "Доходы и расходы по месяцам" },
    { title: "Cash Flow", subtitle: "Движение денежных средств" },
    { title: "Баланс", subtitle: "Упрощённый управленческий баланс" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1A1814", margin: "0 0 4px" }}>
        Управленческая отчётность
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#8B7355" }}>
        Отчёты формируются из событий лога. Загрузите банковскую выписку, чтобы появились данные.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((card) => (
          <div
            key={card.title}
            style={{
              background: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(200,160,60,0.25)",
              borderRadius: 12,
              padding: "20px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: "#1A1814" }}>
                {card.title}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8B7355" }}>
                {card.subtitle}
              </p>
            </div>
            <button
              style={{
                padding: "8px 18px",
                background: "linear-gradient(135deg,#C89A34,#E4C260)",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#4A3208",
                cursor: "pointer",
              }}
              onClick={() => alert("G11 подключение в следующем спринте")}
            >
              Сформировать
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
