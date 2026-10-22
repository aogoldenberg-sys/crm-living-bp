import { useState, useEffect, useRef } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { TEMPLATES, wrapEmail, type Template } from "../mailTemplates";
import { sanitizeEmailHtml } from "../sanitize";
import { authHeader } from "../idToken";

const EMAIL_API = "https://crm-email.aogoldenberg.workers.dev";

interface Attachment { name: string; size: number; data: string; }
interface EmailMsg {
  id: string; mailbox: string; direction: "in" | "out";
  from: string; to: string; subject: string; date: string;
  bodyHtml: string; bodyText: string; attachments: Attachment[];
}

function fmtSize(b: number) {
  return b > 1048576 ? `${(b/1048576).toFixed(1)} МБ` : `${Math.round(b/1024)} КБ`;
}
function fmtDate(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("ru-RU", {
    day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit",
  });
}
function downloadAttachment(a: Attachment) {
  const bytes = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement("a");
  link.href = url; link.download = a.name; link.click();
  URL.revokeObjectURL(url);
}
function clientSlug(name: string) {
  return name.toLowerCase().replace(/[^а-яёa-z0-9]/gi, "_").slice(0, 80);
}

const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };

interface Props { email: string; clientName: string; businessId: string; }

export function ClientEmailSection({ email: emailFromOrder, clientName, businessId }: Props) {
  const [savedEmail, setSavedEmail]   = useState<string | null>(null);
  const [emailInput, setEmailInput]   = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [msgs, setMsgs]               = useState<EmailMsg[]>([]);
  const [loading, setLoading]         = useState(false);
  const [open, setOpen]               = useState<string | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [compose, setCompose]         = useState(false);
  const [to, setTo]                   = useState("");
  const [subj, setSubj]               = useState("");
  const [body, setBody]               = useState("");
  const [files, setFiles]             = useState<File[]>([]);
  const [sending, setSending]         = useState(false);
  const [sent, setSent]               = useState<string | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);
  const [activeTpl, setActiveTpl]     = useState<Template | null>(null);
  const [tplFields, setTplFields]     = useState<Record<string, string>>({});
  const [showTplForm, setShowTplForm] = useState(false);

  // Загружаем сохранённый email из Firestore (если нет в заказах)
  const contactRef = doc(db, `tenants/${businessId}/client_contacts`, clientSlug(clientName));

  useEffect(() => {
    if (emailFromOrder) { setSavedEmail(emailFromOrder); return; }
    getDoc(contactRef).then(snap => {
      if (snap.exists()) {
        const e = (snap.data() as { email?: string }).email ?? "";
        if (e) setSavedEmail(e);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientName, emailFromOrder]);

  const activeEmail = emailFromOrder || savedEmail || null;

  // Загрузка писем когда есть email
  useEffect(() => {
    if (!activeEmail) return;
    setLoading(true); setMsgs([]);
    setTo(activeEmail);
    authHeader()
      .then(headers => fetch(`${EMAIL_API}/inbox?email=${encodeURIComponent(activeEmail)}`, { headers }))
      .then(r => r.json() as Promise<EmailMsg[]>)
      .then(data => setMsgs(Array.isArray(data) ? data : []))
      .catch(() => setMsgs([]))
      .finally(() => setLoading(false));
  }, [activeEmail]);

  async function saveClientEmail() {
    const e = emailInput.trim();
    if (!e || !e.includes("@")) return;
    setSavingEmail(true);
    try {
      await setDoc(contactRef, { email: e, clientName, updatedAt: new Date().toISOString() }, { merge: true });
      setSavedEmail(e); setEmailInput("");
    } catch (ex) {
      alert("Не удалось сохранить email: " + String(ex));
    } finally {
      setSavingEmail(false);
    }
  }

  async function sendEmail() {
    if (!to || !subj || sending) return;
    setSending(true); setSent(null);
    try {
      await postEmail();
    } catch (ex) {
      setSent("Ошибка: " + String(ex));
    } finally {
      setSending(false);
    }
  }

  async function postEmail() {
    const fd = new FormData();
    fd.append("to", to); fd.append("subject", subj);
    // Если это не HTML-шаблон — оборачиваем в фирменный шаблон письма
    const htmlBody = body.trimStart().startsWith("<!DOCTYPE")
      ? body
      : wrapEmail(`<p style="font-size:14px;color:#3d2e1a;line-height:1.8;">${body.replace(/\n\n/g, '</p><p style="font-size:14px;color:#3d2e1a;line-height:1.8;">').replace(/\n/g, "<br>")}</p>`);
    fd.append("body", htmlBody);
    files.forEach(f => fd.append("attachments", f));
    const resp = await fetch(`${EMAIL_API}/send`, { method: "POST", body: fd, headers: await authHeader() });
    const data = await resp.json() as { ok?: boolean; error?: string };
    if (resp.ok && data.ok) {
      setSent("✓ Отправлено");
      setSubj(""); setBody(""); setFiles([]);
      setTimeout(() => { setCompose(false); setSent(null); }, 2000);
    } else { setSent("Ошибка: " + (data.error ?? "неизвестная")); }
  }

  const openMsg = msgs.find(m => m.id === open);

  async function openMessage(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const msg = msgs.find(m => m.id === id);
    if (msg && msg.bodyHtml !== null) return; // already loaded
    setLoadingBody(true);
    try {
      const headers = await authHeader();
      const r = await fetch(`${EMAIL_API}/message?id=${encodeURIComponent(id)}`, { headers });
      const full = await r.json() as EmailMsg;
      setMsgs(prev => prev.map(m => m.id === id ? { ...m, ...full } : m));
    } catch { /* show empty */ } finally {
      setLoadingBody(false);
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#3A2E1E" }}>
          ✉ Переписка
          {activeEmail && !loading && (
            <span style={{ fontSize: 11, fontWeight: 400, color: "#8B7355", marginLeft: 6 }}>
              {activeEmail} · {msgs.length} писем
            </span>
          )}
        </div>
        {activeEmail && (
          <button onClick={() => setCompose(v => !v)} style={{
            fontSize: 11, fontWeight: 700, padding: "5px 12px",
            background: compose ? "#f0ece5" : "#C89A34", color: compose ? "#8B7355" : "#fff",
            border: "none", borderRadius: 7, cursor: "pointer",
          }}>
            {compose ? "Отмена" : "+ Написать"}
          </button>
        )}
      </div>

      {/* Ввод email если не задан */}
      {!activeEmail && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px",
          background: "#faf8f4", border: "1px dashed #e0d8cc", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#8B7355" }}>Email не указан в заказах:</span>
          <input value={emailInput} onChange={e => setEmailInput(e.target.value)}
            placeholder="email@клиента.ru"
            onKeyDown={e => e.key === "Enter" && void saveClientEmail()}
            style={{ flex: 1, padding: "5px 8px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 6 }} />
          <button onClick={() => void saveClientEmail()} disabled={savingEmail || !emailInput.includes("@")}
            style={{ padding: "5px 12px", fontSize: 12, background: "#C89A34", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {savingEmail ? "…" : "Сохранить"}
          </button>
        </div>
      )}

      {/* Форма отправки */}
      {compose && activeEmail && (
        <div style={{ background: "#faf8f4", border: "1px solid rgba(200,154,52,.3)", borderRadius: 10, padding: 16, marginBottom: 14 }}>
          {/* Кнопки шаблонов */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8B7355", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Шаблон</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TEMPLATES.map(tpl => (
                <button key={tpl.id} onClick={() => {
                  if (activeTpl?.id === tpl.id) { setActiveTpl(null); setShowTplForm(false); return; }
                  const init: Record<string,string> = {};
                  tpl.fields.forEach(f => { init[f.key] = f.autoFrom === "clientName" ? clientName : ""; });
                  setActiveTpl(tpl); setTplFields(init); setShowTplForm(true);
                  setSubj(tpl.subject);
                }} style={{
                  padding: "4px 10px", fontSize: 11, borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${activeTpl?.id === tpl.id ? "#C89A34" : "rgba(200,154,52,.3)"}`,
                  background: activeTpl?.id === tpl.id ? "rgba(200,154,52,.12)" : "transparent",
                  color: activeTpl?.id === tpl.id ? "#8B6914" : "#5a4a35", fontWeight: 600,
                }}>{tpl.label}</button>
              ))}
              {activeTpl && <button onClick={() => { setActiveTpl(null); setShowTplForm(false); setBody(""); setSubj(""); }}
                style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, cursor: "pointer", background: "none", border: "1px solid #f0ece5", color: "#aaa" }}>
                ✕ Очистить
              </button>}
            </div>
          </div>

          {/* Форма полей шаблона */}
          {showTplForm && activeTpl && (
            <div style={{ background: "#fff", border: "1px solid rgba(200,154,52,.2)", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
              {activeTpl.fields.map(f => (
                <div key={f.key} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: f.optional ? "#bbb" : "#8B7355", textTransform: "uppercase", marginBottom: 3 }}>
                    {f.label}{f.optional ? " (необяз.)" : ""}
                  </div>
                  {f.type === "textarea" ? (
                    <textarea rows={2} placeholder={f.placeholder}
                      value={tplFields[f.key] ?? ""}
                      onChange={e => setTplFields(v => ({ ...v, [f.key]: e.target.value }))}
                      style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 5, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                  ) : (
                    <input placeholder={f.placeholder}
                      value={tplFields[f.key] ?? ""}
                      onChange={e => setTplFields(v => ({ ...v, [f.key]: e.target.value }))}
                      style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 5, fontFamily: "inherit", boxSizing: "border-box" }} />
                  )}
                </div>
              ))}
              <button onClick={() => { setBody(activeTpl.buildHtml(tplFields)); setShowTplForm(false); }}
                style={{ padding: "6px 16px", fontSize: 12, fontWeight: 700, background: "#C89A34", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                ✓ Применить шаблон
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="Кому"
              style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 6 }} />
            <input value={subj} onChange={e => setSubj(e.target.value)} placeholder="Тема"
              style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 6 }} />
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Текст письма…" rows={5}
              style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 6,
                resize: "vertical", fontFamily: "inherit" }} />
            <div>
              <input ref={fileRef} type="file" multiple style={{ display: "none" }}
                onChange={e => setFiles(Array.from(e.target.files ?? []))} />
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11, padding: "4px 10px",
                background: "none", border: "1px dashed #C89A34", borderRadius: 6, cursor: "pointer", color: "#8B6914" }}>
                📎 Прикрепить файл
              </button>
              {files.map((f, i) => (
                <span key={i} style={{ fontSize: 11, marginLeft: 8, color: "#8B7355" }}>
                  {f.name} ({fmtSize(f.size)})
                  <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}
                    style={{ border:"none", background:"none", cursor:"pointer", color:"#aaa", marginLeft: 2 }}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => void sendEmail()} disabled={sending || !to || !subj} style={{
                padding: "7px 20px", background: "#C89A34", color: "#fff",
                border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                {sending ? "Отправляем…" : "Отправить"}
              </button>
              {sent && <span style={{ fontSize: 12, color: sent.startsWith("✓") ? "#2E7D32" : "#C62828" }}>{sent}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Открытое письмо */}
      {openMsg && (
        <div style={{ background: "#fff", border: "1px solid #C89A34", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{openMsg.subject}</div>
            <button onClick={() => setOpen(null)} style={{ border:"none", background:"none", cursor:"pointer", color:"#aaa", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ fontSize: 11, color: "#8B7355", marginBottom: 10 }}>
            От: {openMsg.from} → {openMsg.to} · {fmtDate(openMsg.date)}
          </div>
          {loadingBody
            ? <div style={{ fontSize: 12, color: "#aaa", padding: "10px 0" }}>Загрузка письма…</div>
            : <div style={{ fontSize: 12, lineHeight: 1.6, maxHeight: 320, overflowY: "auto",
                borderTop: "1px solid #f0ece5", paddingTop: 10 }}
                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(openMsg.bodyHtml ?? "") }} />
          }
          {openMsg.attachments.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #f0ece5" }}>
              {openMsg.attachments.map((a, i) => (
                <button key={i} onClick={() => downloadAttachment(a)} style={{ fontSize: 11, marginRight: 8,
                  padding: "3px 8px", background: "#f0ece5", border: "1px solid #e0d8cc",
                  borderRadius: 5, cursor: "pointer", color: "#3A2E1E" }}>
                  📎 {a.name} ({fmtSize(a.size)})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Список писем */}
      {activeEmail && loading && <div style={{ fontSize: 12, color: "#aaa" }}>Загрузка переписки…</div>}
      {activeEmail && !loading && msgs.length === 0 && (
        <div style={{ fontSize: 12, color: "#ccc", padding: "8px 0" }}>Писем с {activeEmail} не найдено</div>
      )}
      {activeEmail && !loading && msgs.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355", width: 28 }}></th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Тема</th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Дата</th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Ящик</th>
            </tr>
          </thead>
          <tbody>
            {msgs.map(m => (
              <tr key={m.id} onClick={() => void openMessage(m.id)}
                style={{ borderBottom: "1px solid #f0ece5", cursor: "pointer",
                  background: open === m.id ? "rgba(200,154,52,.06)" : undefined }}
                onMouseEnter={e => { if (open !== m.id) e.currentTarget.style.background = "#faf8f4"; }}
                onMouseLeave={e => { if (open !== m.id) e.currentTarget.style.background = ""; }}
              >
                <td style={TD}>
                  <span style={{ fontSize: 13, color: m.direction === "in" ? "#1565C0" : "#2E7D32" }}>
                    {m.direction === "in" ? "↙" : "↗"}
                  </span>
                </td>
                <td style={{ ...TD, fontWeight: 500 }}>
                  {m.subject || "(без темы)"}
                  {m.attachments.length > 0 && <span style={{ marginLeft: 5, fontSize: 11 }}>📎</span>}
                </td>
                <td style={{ ...TD, color: "#888", whiteSpace: "nowrap", fontSize: 11 }}>{fmtDate(m.date)}</td>
                <td style={{ ...TD, color: "#aaa", fontSize: 10, fontFamily: "monospace" }}>
                  {m.mailbox.split("@")[0]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
