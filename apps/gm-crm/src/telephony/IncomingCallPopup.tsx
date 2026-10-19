import { useEffect, useState, useRef } from "react";
import { MATRIX_WORKER_URL } from "./config";
import { authHeader } from "../orders/idToken";
import { useClientPhoneMap, normPhone } from "../orders/useClientPhoneMap";

interface CallEvent {
  type: string;
  phone: string;
  account: string;
  callid: string;
  ts: number;
}

/** Опрашивает Worker каждые 4с на предмет входящих звонков */
export function IncomingCallPopup() {
  const [calls, setCalls] = useState<CallEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phoneMap = useClientPhoneMap("gustoriko");

  useEffect(() => {
    async function poll() {
      try {
        const r = await fetch(`${MATRIX_WORKER_URL}/events`, { headers: await authHeader() });
        if (r.ok) setCalls(await r.json() as CallEvent[]);
      } catch { /* сеть недоступна — молчим */ }
    }
    poll();
    timerRef.current = setInterval(poll, 4000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  if (calls.length === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 10,
      pointerEvents: "none",
    }}>
      {calls.map(c => {
        const clientName = c.phone ? phoneMap.get(normPhone(c.phone)) : undefined;
        return (
          <div key={c.callid} style={{
            background: "#fff",
            border: "2px solid #1565C0",
            borderRadius: 12, padding: "14px 18px",
            boxShadow: "0 8px 32px rgba(21,101,192,.25)",
            minWidth: 240, pointerEvents: "auto",
            animation: "slideIn .25s ease",
          }}>
            <div style={{ fontSize: 11, color: "#1565C0", fontWeight: 700, marginBottom: 4 }}>
              📞 ВХОДЯЩИЙ ЗВОНОК
            </div>
            {clientName ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#3A2E1E" }}>{clientName}</div>
                <div style={{ fontSize: 13, color: "#8B7355", marginTop: 2, letterSpacing: .5 }}>{c.phone}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>{c.phone}</div>
                <div style={{ fontSize: 11, color: "#C62828", marginTop: 2, fontWeight: 600 }}>Новый клиент</div>
              </>
            )}
            {c.account && (
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>
                на номер: {c.account}
              </div>
            )}
            <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>
              {new Date(c.ts).toLocaleTimeString("ru-RU")}
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
