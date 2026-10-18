import { useEffect, useState } from "react";
import { MATRIX_WORKER_URL } from "./config";
import { useClientPhoneMap, normPhone } from "../orders/useClientPhoneMap";

interface CallRecord {
  uid: string;
  type: "in" | "out" | "missed";
  client: string;   // номер клиента
  account: string;  // внутренний номер менеджера
  start: string;
  wait: number;
  duration: number;
  record: string | null;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  in:     { label: "↙ Входящий",  color: "#1565C0" },
  out:    { label: "↗ Исходящий", color: "#2E7D32" },
  missed: { label: "✗ Пропущен",  color: "#C62828" },
};

function fmtDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}м ${s}с` : `${s}с`;
}

const PERIODS = [
  { id: "today",      label: "Сегодня" },
  { id: "yesterday",  label: "Вчера" },
  { id: "this_week",  label: "Неделя" },
  { id: "this_month", label: "Месяц" },
];
const TYPES = [
  { id: "all",    label: "Все" },
  { id: "in",     label: "Входящие" },
  { id: "out",    label: "Исходящие" },
  { id: "missed", label: "Пропущенные" },
];

export function CallLogView() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState("today");
  const [type, setType] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const phoneMap = useClientPhoneMap("gustoriko");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${MATRIX_WORKER_URL}/history?period=${period}&type=${type}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<CallRecord[]>; })
      .then(data => setCalls(data))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [period, type]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="go-header">
        <h2 className="go-title">Звонки</h2>
        <p className="go-subtitle">История Matrix Telecom</p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${period === p.id ? "#C89A34" : "#e0d8cc"}`,
              background: period === p.id ? "rgba(200,154,52,.1)" : "transparent",
              color: period === p.id ? "#8B6914" : "#777",
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)} style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${type === t.id ? "#1565C0" : "#e0d8cc"}`,
              background: type === t.id ? "rgba(21,101,192,.08)" : "transparent",
              color: type === t.id ? "#1565C0" : "#777",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {loading && <div className="go-empty">Загрузка…</div>}
      {error && <div className="go-empty" style={{ color: "#C62828" }}>Ошибка: {error}</div>}
      {!loading && !error && calls.length === 0 && (
        <div className="go-empty">Звонков нет</div>
      )}

      {!loading && calls.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e8e3da" }}>
                <th style={TH}>Тип</th>
                <th style={TH}>Клиент</th>
                <th style={TH}>Номер</th>
                <th style={TH}>Менеджер</th>
                <th style={TH}>Дата/время</th>
                <th style={TH}>Ожидание</th>
                <th style={TH}>Длит.</th>
                <th style={TH}>Запись</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c, i) => {
                const meta = TYPE_LABELS[c.type] ?? { label: c.type, color: "#777" };
                const clientName = c.client ? phoneMap.get(normPhone(c.client)) : undefined;
                return (
                  <tr key={c.uid ?? i} style={{ borderBottom: "1px solid #f0ebe2" }}>
                    <td style={TD}>
                      <span style={{ color: meta.color, fontWeight: 600, fontSize: 11 }}>{meta.label}</span>
                    </td>
                    <td style={TD}>
                      {clientName
                        ? <span style={{ fontWeight: 600, color: "#3A2E1E" }}>{clientName}</span>
                        : <span style={{ color: "#aaa", fontSize: 11 }}>Новый</span>
                      }
                    </td>
                    <td style={{ ...TD, color: "#8B7355", fontFamily: "monospace", fontSize: 12 }}>{c.client || "—"}</td>
                    <td style={{ ...TD, color: "#8B7355" }}>{c.account || "—"}</td>
                    <td style={{ ...TD, color: "#555", whiteSpace: "nowrap" }}>{c.start || "—"}</td>
                    <td style={{ ...TD, color: "#aaa" }}>{fmtDuration(c.wait)}</td>
                    <td style={TD}>{fmtDuration(c.duration)}</td>
                    <td style={TD}>
                      {c.record ? (
                        <a href={c.record} target="_blank" rel="noreferrer" style={{
                          color: "#1565C0", fontSize: 11, textDecoration: "none",
                        }}>▶ Слушать</a>
                      ) : <span style={{ color: "#ccc" }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#8B7355" };
const TD: React.CSSProperties = { padding: "8px 10px" };
