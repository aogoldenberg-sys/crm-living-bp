import { useState, useEffect } from "react";
import { collection, getDocs, addDoc } from "firebase/firestore";
import { db } from "../../firebase";
import "../orders.css";
import { TEMPLATES, wrapEmail, type Template } from "../mailTemplates";

interface Client {
  id: string;
  email: string;
  customerName: string;
}


export function MailingView({ businessId }: { businessId: string }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [activeTpl, setActiveTpl] = useState<Template | null>(null);
  const [fieldVals, setFieldVals] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [freeText, setFreeText] = useState(false);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    getDocs(collection(db, `tenants/${businessId}/orders`))
      .then((snap) => {
        const seen = new Map<string, string>();
        snap.docs.forEach((d) => {
          const data = d.data() as { email?: string | null; customerName?: string };
          if (data.email) seen.set(data.email, data.customerName ?? data.email);
        });
        setClients(
          [...seen.entries()]
            .map(([email, customerName]) => ({ id: email, email, customerName }))
            .sort((a, b) => a.customerName.localeCompare(b.customerName, "ru"))
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [businessId]);

  function selectTemplate(tpl: Template) {
    const selectedClients = clients.filter(c => selected.has(c.id));
    const autoName = selectedClients.length === 1 ? selectedClients[0].customerName : "";
    const initial: Record<string, string> = {};
    tpl.fields.forEach(f => {
      initial[f.key] = f.autoFrom === "clientName" ? autoName : "";
    });
    setActiveTpl(tpl);
    setFieldVals(initial);
    setSubject(tpl.subject);
    setBody("");
    setPreview(false);
  }

  function applyFields() {
    if (!activeTpl) return;
    setBody(activeTpl.buildHtml(fieldVals));
    setPreview(true);
  }

  function toggleClient(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      // Авто-подставляем имя если выбран один
      if (activeTpl) {
        const newSelected = [...next];
        if (newSelected.length === 1) {
          const c = clients.find(cl => cl.id === newSelected[0]);
          if (c) setFieldVals(v => ({ ...v, customer: c.customerName }));
        }
      }
      return next;
    });
  }

  async function send() {
    if (!subject.trim() || !body.trim() || selected.size === 0) return;
    const emails = clients.filter(c => selected.has(c.id)).map(c => c.email);
    const htmlBody = body.trimStart().startsWith("<!DOCTYPE")
      ? body
      : wrapEmail(`<p style="font-size:14px;color:#3d2e1a;line-height:1.8;">${body.replace(/\n\n/g, '</p><p style="font-size:14px;color:#3d2e1a;line-height:1.8;">').replace(/\n/g, "<br>")}</p>`);
    setSending(true); setResult(null);
    try {
      const res = await fetch("https://opentgp.ru/food/pay-proxy.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-mailing" },
        body: JSON.stringify({ subject, body_html: htmlBody, emails }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        // Логируем каждое письмо в Firestore для истории в карточке клиента
        const sentAt = new Date().toISOString();
        const recipients = clients.filter(c => selected.has(c.id));
        await Promise.all(recipients.map(c => addDoc(collection(db, `tenants/${businessId}/mailings`), {
          email: c.email, customerName: c.customerName,
          subject, templateId: activeTpl?.id ?? "custom", sentAt,
        })));
        setResult({ ok: true, message: `Отправлено: ${emails.length} писем` });
        setSelected(new Set()); setSubject(""); setBody(""); setActiveTpl(null); setFieldVals({}); setFreeText(false);
      } else {
        setResult({ ok: false, message: data.error ?? `Ошибка ${res.status}` });
      }
    } catch (e) { setResult({ ok: false, message: (e as Error).message }); }
    finally { setSending(false); }
  }

  const canSend = subject.trim() && body.trim() && selected.size > 0 && !sending;
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#8B7355", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, display: "block" };
  const inp: React.CSSProperties = { padding: "8px 12px", border: "1px solid rgba(200,154,52,.25)", borderRadius: 8, fontSize: 13, background: "rgba(254,252,246,.8)", color: "#1A1814", fontFamily: "inherit", width: "100%", boxSizing: "border-box" };

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Рассылка клиентам</h1>
      </div>

      {/* Выбор шаблона или свободного текста */}
      <div style={{ maxWidth: 680, marginBottom: 20 }}>
        <span style={lbl}>Письмо</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TEMPLATES.map(tpl => (
            <button key={tpl.id} onClick={() => { setFreeText(false); selectTemplate(tpl); }} style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
              fontFamily: "inherit", fontWeight: 600,
              border: `1.5px solid ${activeTpl?.id === tpl.id ? "#C89A34" : "rgba(200,154,52,.3)"}`,
              background: activeTpl?.id === tpl.id ? "rgba(200,154,52,.12)" : "transparent",
              color: activeTpl?.id === tpl.id ? "#8B6914" : "#5a4a35",
            }}>{tpl.label}</button>
          ))}
          <button onClick={() => {
            setFreeText(f => !f);
            setActiveTpl(null); setFieldVals({}); setBody(""); setPreview(false);
          }} style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
            fontFamily: "inherit", fontWeight: 600,
            border: `1.5px solid ${freeText ? "#C89A34" : "rgba(200,154,52,.3)"}`,
            background: freeText ? "rgba(200,154,52,.12)" : "transparent",
            color: freeText ? "#8B6914" : "#5a4a35",
          }}>✉ Своё письмо</button>
        </div>
      </div>

      {/* Форма полей шаблона */}
      {activeTpl && (
        <div style={{ maxWidth: 680, background: "rgba(255,255,255,.7)", border: "1px solid rgba(200,154,52,.2)", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3d2e1a", marginBottom: 16 }}>
            Заполните данные для подстановки
          </div>

          {activeTpl.fields.map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ ...lbl, color: f.optional ? "#aaa" : "#8B7355" }}>
                {f.label}{f.optional ? " (необязательно)" : ""}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  style={{ ...inp, resize: "vertical" }}
                  rows={2}
                  placeholder={f.placeholder}
                  value={fieldVals[f.key] ?? ""}
                  onChange={e => setFieldVals(v => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  style={inp}
                  placeholder={f.placeholder}
                  value={fieldVals[f.key] ?? ""}
                  onChange={e => setFieldVals(v => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <button
            onClick={applyFields}
            style={{
              marginTop: 4, padding: "9px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
              background: "linear-gradient(135deg,#C89A34,#E4C260)", color: "#3A2800", border: "none",
            }}
          >
            ✓ Сформировать письмо
          </button>
        </div>
      )}

      {/* Тема + превью / свободный текст */}
      {(body || freeText) && (
        <div style={{ maxWidth: 680, marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Тема письма</label>
            <input style={inp} value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={lbl}>Письмо</span>
            {!freeText && (
              <button onClick={() => setPreview(p => !p)} style={{ fontSize: 11, fontWeight: 600, color: "#1565C0", background: "none", border: "none", cursor: "pointer" }}>
                {preview ? "✏️ HTML-код" : "👁 Превью"}
              </button>
            )}
          </div>
          {freeText ? (
            <textarea style={{ ...inp, resize: "vertical" }} rows={8} placeholder="Текст письма…"
              value={body} onChange={e => setBody(e.target.value)} />
          ) : preview ? (
            <div style={{ border: "1px solid rgba(200,154,52,.25)", borderRadius: 8, overflow: "hidden" }}>
              <iframe srcDoc={body} style={{ width: "100%", height: 520, border: "none", display: "block" }} title="preview" sandbox="allow-same-origin" />
            </div>
          ) : (
            <textarea style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 11 }} rows={8}
              value={body} onChange={e => setBody(e.target.value)} />
          )}
        </div>
      )}

      {/* Получатели */}
      <div style={{ maxWidth: 680, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1814" }}>Получатели</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="go-btn go-btn--outline" onClick={() => setSelected(new Set(clients.map(c => c.id)))} disabled={loading || clients.length === 0}>Выбрать всех</button>
            <button className="go-btn go-btn--outline" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Снять всех</button>
          </div>
        </div>
        {loading && <div className="go-empty">Загрузка…</div>}
        {!loading && clients.length === 0 && <div className="go-empty">Нет клиентов с email</div>}
        {!loading && clients.length > 0 && (
          <div style={{ background: "rgba(255,255,255,.75)", border: "1px solid rgba(200,154,52,.2)", borderRadius: 12, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
            {clients.map((c, i) => (
              <label key={c.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", cursor: "pointer",
                borderBottom: i < clients.length - 1 ? "1px solid rgba(200,154,52,.1)" : "none",
                background: selected.has(c.id) ? "rgba(200,154,52,.06)" : "transparent",
              }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleClient(c.id)}
                  style={{ accentColor: "#C89A34", width: 15, height: 15, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#1A1814" }}>
                  {c.customerName}
                  <span style={{ color: "#8B7355", marginLeft: 6 }}>({c.email})</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 13, color: "#8B7355" }}>
          Выбрано: <b style={{ color: "#1A1814" }}>{selected.size}</b> получателей
        </div>
      </div>

      <button className="go-btn"
        style={{ background: canSend ? "linear-gradient(135deg,#C89A34,#E4C260)" : undefined, color: canSend ? "#3A2800" : undefined, fontSize: 14, padding: "10px 24px" }}
        disabled={!canSend} onClick={() => void send()}>
        {sending ? "Отправка…" : "📨 Отправить рассылку"}
      </button>

      {result && (
        <div style={{
          marginTop: 16, padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, maxWidth: 680,
          background: result.ok ? "rgba(22,163,74,.12)" : "rgba(198,40,40,.10)",
          border: `1px solid ${result.ok ? "rgba(22,163,74,.3)" : "rgba(198,40,40,.3)"}`,
          color: result.ok ? "#14532D" : "#7F1D1D",
        }}>
          {result.ok ? "✅ " : "❌ "}{result.message}
        </div>
      )}
    </div>
  );
}
