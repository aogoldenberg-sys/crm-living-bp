import type { PlanDiff } from "@crm/schemas";

interface Props {
  diffs: PlanDiff[];
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function PlanDiffModal({ diffs, onConfirm, onCancel, loading }: Props) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: "24px 28px", maxWidth: 560, width: "90%",
        boxShadow: "0 8px 40px rgba(0,0,0,.25)",
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1A1814" }}>
          Изменения плана
        </h3>

        {diffs.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>Нет изменений для отображения</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Параметр</th>
                <th style={thStyle}>Было</th>
                <th style={thStyle}>Станет</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0ebe0" }}>
                  <td style={tdStyle}>{d.field}</td>
                  <td style={{ ...tdStyle, color: "#C62828" }}>{d.before}</td>
                  <td style={{ ...tdStyle, color: "#2E7D32" }}>{d.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ fontSize: 12, color: "#888", margin: "0 0 20px", lineHeight: 1.5 }}>
          После подтверждения текущий план будет архивирован. Откат невозможен через UI — только через поддержку.
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8, border: "1px solid #bbb", background: "transparent", color: "#666", cursor: "pointer" }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{ fontSize: 13, padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1A3E1A,#2E7D32)", color: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            {loading ? "Применяем…" : "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 700,
  color: "#8B7355", textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: "2px solid #f0ebe0",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px", verticalAlign: "top", color: "#3A2E1E",
};
