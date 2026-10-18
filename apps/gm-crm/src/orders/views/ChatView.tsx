import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, orderBy, addDoc } from "firebase/firestore";
import { db } from "../../firebase";
import "../orders.css";

interface ChatMsg {
  id: string;
  text: string;
  author: string;
  ts: string;
}

export function ChatView({ businessId, currentUser }: { businessId: string; currentUser: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, `tenants/${businessId}/chat`), orderBy("ts", "asc"));
    return onSnapshot(q, snap => {
      setMsgs(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<ChatMsg, "id">) })));
    });
  }, [businessId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    await addDoc(collection(db, `tenants/${businessId}/chat`), {
      text: trimmed,
      author: currentUser,
      ts: new Date().toISOString(),
    });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Чат сотрудников</h1>
      </div>

      <div style={{ height: "calc(100vh - 260px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
        {msgs.length === 0 && (
          <div className="go-empty">Сообщений пока нет</div>
        )}
        {msgs.map(m => {
          const mine = m.author === currentUser;
          const time = new Date(m.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "65%",
                background: mine ? "rgba(200,154,52,.18)" : "rgba(255,255,255,.75)",
                border: `1px solid ${mine ? "rgba(200,154,52,.35)" : "rgba(200,154,52,.15)"}`,
                borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                padding: "8px 12px",
                backdropFilter: "blur(6px)",
              }}>
                <div style={{ fontSize: 11, color: "#8B7355", marginBottom: 3 }}>
                  <strong style={{ color: "#1A1814" }}>{m.author}</strong>
                  <span style={{ marginLeft: 6 }}>{time}</span>
                </div>
                <div style={{ fontSize: 13, color: "#1A1814", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          placeholder="Сообщение… (Enter — отправить)"
          style={{
            flex: 1, padding: "9px 12px", border: "1px solid rgba(200,154,52,.3)",
            borderRadius: 10, fontSize: 13, background: "rgba(254,252,246,.9)",
            color: "#1A1814", fontFamily: "inherit", resize: "none", outline: "none",
          }}
          onFocus={e => (e.target.style.borderColor = "#C89A34")}
          onBlur={e => (e.target.style.borderColor = "rgba(200,154,52,.3)")}
        />
        <button
          onClick={() => void send()}
          style={{
            padding: "0 20px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg,#C89A34,#E4C260)",
            color: "#3A2800", fontWeight: 700, fontSize: 13,
            cursor: "pointer", alignSelf: "stretch", minWidth: 100,
          }}
        >
          Отправить
        </button>
      </div>
    </div>
  );
}
