import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, where, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub, statusLabel, statusColor, useOrders, type Order, type OrderItem } from "../useOrders";
import { MATRIX_WORKER_URL } from "../../telephony/config";
import { authHeader } from "../idToken";
import { matchesRegion } from "../region";
import { orderItemToUpd } from "../money";
import { PhoneButton } from "../../telephony/PhoneButton";
import { ClientEmailSection } from "./ClientEmailSection";
import { ReconciliationModal } from "./ReconciliationModal";
import { UpdModal, type UpdItem } from "./UpdModal";
import { MailingView } from "./MailingView";

function clientSlug(name: string) {
  return name.toLowerCase().replace(/[^а-яёa-z0-9]/gi, "_").slice(0, 80);
}

const SEEN_KEY = (name: string) => `gm_seen_cli_${clientSlug(name)}`;
const CLIENTS_TAB_KEY = "gm_clients_tab";

function getNewCount(c: { name: string; orders: { createdAt?: string }[] }): number {
  const seen = localStorage.getItem(SEEN_KEY(c.name)) ?? "0";
  return c.orders.filter(o => (o.createdAt ?? "") > seen).length;
}

// unitPrice в заказах НаПолке бывает в рублях — цена и итог строки берутся из totalKopecks
function toUpdItems(items: OrderItem[]): UpdItem[] {
  return items.map(orderItemToUpd);
}

interface ContactOverride {
  phone?: string; email?: string; inn?: string; address?: string; comment?: string;
}

interface ClientCard {
  name: string;
  phone: string;
  email: string;
  inn: string;
  address: string;
  region: string;
  orders: Order[];
  totalKopecks: number;
  lastOrderDate: string;
}

const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };

interface CallRecord {
  uid: string; type: string; client: string; account: string;
  via: string; start: string; wait: number; duration: number; record: string | null;
}

// Нормализует телефон: только цифры, последние 10
function normPhone(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

// ISO "2026-10-15T14:30:07Z" → "15.10.2026 17:30" (МСК +3)
function fmtCallDate(s: string): string {
  if (!s) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDur(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}м ${s}с` : `${s}с`;
}

const CALL_TYPE: Record<string, { label: string; color: string }> = {
  in:     { label: "↙ Входящий",  color: "#1565C0" },
  out:    { label: "↗ Исходящий", color: "#2E7D32" },
  missed: { label: "✗ Пропущен",  color: "#C62828" },
};

function ClientCalls({ phone }: { phone: string }) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!phone) { setLoading(false); return; }
    const norm = normPhone(phone);
    setLoading(true);
    authHeader()
      .then(headers => fetch(`${MATRIX_WORKER_URL}/history?period=this_month&type=all`, { headers }))
      .then(r => r.ok ? r.json() as Promise<CallRecord[]> : [])
      .then(data => setCalls(data.filter(c => normPhone(c.client) === norm)))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [phone]);

  if (!phone) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#3A2E1E", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        📞 Звонки
        {!loading && <span style={{ fontSize: 11, fontWeight: 400, color: "#8B7355" }}>за месяц · {calls.length} шт.</span>}
      </div>

      {loading && <div style={{ fontSize: 12, color: "#aaa" }}>Загрузка…</div>}

      {!loading && calls.length === 0 && (
        <div style={{ fontSize: 12, color: "#aaa", padding: "12px 0" }}>Звонков не найдено</div>
      )}

      {!loading && calls.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Тип</th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Дата</th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Менеджер</th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Длит.</th>
              <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Запись</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => {
              const meta = CALL_TYPE[c.type] ?? { label: c.type, color: "#777" };
              return (
                <tr key={c.uid || i} style={{ borderBottom: "1px solid #f0ece5" }}>
                  <td style={TD}>
                    <span style={{ color: meta.color, fontWeight: 600, fontSize: 11 }}>{meta.label}</span>
                  </td>
                  <td style={{ ...TD, color: "#555", whiteSpace: "nowrap" }}>{fmtCallDate(c.start)}</td>
                  <td style={{ ...TD, color: "#8B7355" }}>{c.account || "—"}</td>
                  <td style={TD}>{fmtDur(c.duration)}</td>
                  <td style={TD}>
                    {c.record && c.record.trim().startsWith("http")
                      ? <a href={c.record.trim()} target="_blank" rel="noreferrer" style={{ color: "#1565C0", fontSize: 11 }}>▶ Слушать</a>
                      : <span style={{ color: "#ccc" }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const TPL_LABEL: Record<string, string> = {
  delivery: "📦 Перенос доставки", substitution: "🔄 Замена позиций",
  offer: "🎯 Спецпредложение", custom: "✉ Письмо",
};

interface MailRecord { id: string; subject: string; templateId: string; sentAt: string; email: string; }

function ClientMailings({ email, businessId }: { email: string; businessId: string }) {
  const [mails, setMails] = useState<MailRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) { setLoading(false); return; }
    getDocs(query(
      collection(db, `tenants/${businessId}/mailings`),
      where("email", "==", email),
      orderBy("sentAt", "desc"),
    )).then(snap => {
      setMails(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<MailRecord, "id">) })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [email, businessId]);

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#8B7355", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
        Рассылки {!loading && <span style={{ fontSize: 11, fontWeight: 400 }}>· {mails.length} шт.</span>}
      </div>
      {!loading && mails.length === 0 && <div style={{ fontSize: 12, color: "#ccc" }}>Писем не отправлялось</div>}
      {mails.map(m => (
        <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 10px", background: "#fff", borderRadius: 8,
          border: "1px solid rgba(200,154,52,.15)", marginBottom: 6, fontSize: 12 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{TPL_LABEL[m.templateId] ?? m.templateId}</div>
            <div style={{ color: "#8B7355", marginTop: 2 }}>{m.subject}</div>
          </div>
          <div style={{ color: "#aaa", whiteSpace: "nowrap", marginLeft: 12 }}>
            {new Date(m.sentAt).toLocaleDateString("ru-RU")}
          </div>
        </div>
      ))}
    </div>
  );
}

// Извлекает город из строки адреса: "г Москва, ул Ленина" → "Москва"
function extractCity(address: string): string {
  const m = address.match(/г\.?\s+([^,]+)/i);
  return m ? m[1].trim() : "";
}

const SPB_RE = /санкт.петербург|ленинградская\s*обл/i;

// Возвращает нормализованный регион для фильтрации и списка городов
// Учитывает address + region, группирует СПб + ЛО
function getClientCity(c: ClientCard): string {
  const fromAddr = extractCity(c.address);
  const city = fromAddr || c.region;
  if (!city) {
    // Адрес без "г." — ищем СПб напрямую
    if (SPB_RE.test(c.address)) return "Санкт-Петербург и ЛО";
    return "";
  }
  if (SPB_RE.test(city)) return "Санкт-Петербург и ЛО";
  return city;
}

// Клиент с реальным именем — не "Заказ #..."
function isRealClient(name: string) {
  return !/^заказ\s*#/i.test(name.trim());
}

export function ClientsView({ businessId, regionFilter }: { businessId: string; regionFilter?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [contact, setContact]   = useState<ContactOverride | null>(null);
  const [editing, setEditing]   = useState(false);
  const [editF, setEditF]       = useState({ phone: "", email: "", inn: "", address: "", comment: "" });
  const [saving, setSaving]     = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [reconOpen, setReconOpen] = useState(false);
  const [updOrder, setUpdOrder]   = useState<Order | null>(null);
  const [subTab, setSubTab]       = useState<"clients" | "mailing">("clients");

  // История клиента нужна полностью: живые заказы + архив однократно (без живой подписки на всю коллекцию)
  const { orders, loading } = useOrders(businessId, "director", "", { archive: true });
  const clients = useMemo(() => {
    // Группируем по customerName, пропускаем "Заказ #..."
    const map = new Map<string, ClientCard>();
    for (const o of orders) {
      const key = o.customerName || "—";
      if (!isRealClient(key)) continue;
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          phone:   o.phone   ?? "",
          email:   o.email   ?? "",
          inn:     o.customerInn ?? "",
          address: o.address ?? "",
          region:  o.region  ?? "",
          orders: [],
          totalKopecks: 0,
          lastOrderDate: o.createdAt ?? "",
        });
      }
      const c = map.get(key)!;
      c.orders.push(o);
      c.totalKopecks += o.totalKopecks ?? 0;
      // Обновляем контакт из последних данных если пришло новое
      if (o.phone   && !c.phone)   c.phone   = o.phone;
      if (o.email   && !c.email)   c.email   = o.email;
      if (o.address && !c.address) c.address = o.address;
      if (o.customerInn && !c.inn) c.inn     = o.customerInn;
    }

    return [...map.values()].sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate));
  }, [orders]);

  // Отмечаем вкладку "Клиенты" просмотренной при монтировании
  useEffect(() => {
    localStorage.setItem(CLIENTS_TAB_KEY, new Date().toISOString());
  }, []);

  useEffect(() => {
    if (!selected) { setContact(null); setEditing(false); setExpandedItems(new Set()); return; }
    // Отмечаем клиента просмотренным
    localStorage.setItem(SEEN_KEY(selected), new Date().toISOString());
    getDoc(doc(db, `tenants/${businessId}/client_contacts`, clientSlug(selected)))
      .then(snap => { if (snap.exists()) setContact(snap.data() as ContactOverride); else setContact(null); })
      .catch(() => setContact(null));
  }, [selected, businessId]);

  async function saveContact(name: string) {
    setSaving(true);
    await setDoc(doc(db, `tenants/${businessId}/client_contacts`, clientSlug(name)),
      { ...editF, clientName: name, updatedAt: new Date().toISOString() }, { merge: true });
    setContact(c => ({ ...c, ...editF }));
    setEditing(false);
    setSaving(false);
  }

  if (loading) return <div className="go-main"><div className="go-empty">Загрузка…</div></div>;

  const cities = [...new Set(
    clients.map(c => getClientCity(c)).filter(Boolean)
  )].sort();

  const SPB_RE_CLI = /санкт.петербург|спб|ленинградская\s*обл/i;

  const filtered = clients.filter(c => {
    if (search && !(
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.inn.includes(search)
    )) return false;
    if (cityFilter && getClientCity(c) !== cityFilter) return false;
    // region "spb" (латиница) регулярка не ловит — добавляем общий matchesRegion
    if (regionFilter === "spb" && !SPB_RE_CLI.test(getClientCity(c)) && !matchesRegion(c, "spb")) return false;
    return true;
  });

  const active = selected ? clients.find(c => c.name === selected) : null;

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "6px 20px", fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer",
    border: "none", borderRadius: 8,
    background: active ? "linear-gradient(135deg,#C89A34,#E8B84B)" : "transparent",
    color: active ? "#fff" : "#8B6914",
    boxShadow: active ? "0 2px 8px rgba(200,154,52,.35)" : "none",
    transition: "all .18s",
  });

  return (
    <div className="go-main">
      <div className="go-header" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h1 className="go-title" style={{ marginRight: "auto" }}>Клиенты · Густорико</h1>
        {!active && (
          <div style={{ display: "flex", gap: 4, background: "rgba(200,154,52,.08)", borderRadius: 10, padding: 4 }}>
            <button style={TAB_STYLE(subTab === "clients")} onClick={() => setSubTab("clients")}>👥 Клиенты</button>
            <button style={TAB_STYLE(subTab === "mailing")} onClick={() => setSubTab("mailing")}>📨 Рассылка</button>
          </div>
        )}
      </div>

      {subTab === "mailing" && !active ? (
        <MailingView businessId={businessId} />
      ) : active ? (
        // ── Карточка клиента ─────────────────────────────────────────────────
        <div>
          <button onClick={() => setSelected(null)}
            style={{ marginBottom: 16, fontSize: 12, cursor: "pointer",
              background: "none", border: "none", color: "#8B6914" }}>
            ← Все клиенты
          </button>

          {/* Карточка клиента */}
          {(() => {
            const phone   = contact?.phone   || active.phone;
            const email   = contact?.email   || active.email;
            const inn     = contact?.inn     || active.inn;
            const address = contact?.address || active.address;
            const comment = contact?.comment ?? "";
            return (
              <div style={{ background: "#fff", border: "1px solid rgba(200,154,52,.25)",
                borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "#3A2E1E" }}>{active.name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setReconOpen(true)}
                      style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                        background: "none", border: "1px solid rgba(200,154,52,.3)", color: "#8B6914", fontWeight: 600 }}>
                      📋 Акт сверки
                    </button>
                    <button onClick={() => {
                      setEditF({ phone: phone || "", email: email || "", inn: inn || "", address: address || "", comment });
                      setEditing(e => !e);
                    }} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                      background: editing ? "rgba(200,154,52,.12)" : "none",
                      border: "1px solid rgba(200,154,52,.3)", color: "#8B6914", fontWeight: 600 }}>
                      {editing ? "✕ Закрыть" : "✏️ Редактировать"}
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#5A4A35", marginTop: 8, alignItems: "center" }}>
                  {phone   && <PhoneButton phone={phone} extension={null} size={12} />}
                  {email   && <span>✉ {email}</span>}
                  {inn     && <span>ИНН {inn}</span>}
                  {address && <span>📍 {address}</span>}
                  {active.region && <span>🗺 {active.region}</span>}
                </div>
                {comment && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#5A4A35", background: "#faf8f4",
                    border: "1px solid rgba(200,154,52,.15)", borderRadius: 6, padding: "6px 10px" }}>
                    💬 {comment}
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <b>{active.orders.length}</b> заказов · итого <b style={{ color: "#2E7D32" }}>{fmtRub(active.totalKopecks)}</b>
                </div>

                {/* Форма редактирования */}
                {editing && (
                  <div style={{ marginTop: 14, borderTop: "1px solid #f0ece5", paddingTop: 14, display: "grid", gap: 8 }}>
                    {([["phone","📞 Телефон"],["email","✉ Email"],["inn","ИНН"],["address","📍 Адрес"]] as const).map(([k, lbl]) => (
                      <div key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#8B7355", width: 80, flexShrink: 0 }}>{lbl}</span>
                        <input value={editF[k]} onChange={e => setEditF(f => ({ ...f, [k]: e.target.value }))}
                          style={{ flex: 1, padding: "5px 8px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 6 }} />
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 11, color: "#8B7355", width: 80, flexShrink: 0, paddingTop: 6 }}>💬 Комментарий</span>
                      <textarea value={editF.comment} rows={2}
                        onChange={e => setEditF(f => ({ ...f, comment: e.target.value }))}
                        style={{ flex: 1, padding: "5px 8px", fontSize: 12, border: "1px solid #e0d8cc", borderRadius: 6, resize: "vertical", fontFamily: "inherit" }} />
                    </div>
                    <button onClick={() => void saveContact(active.name)} disabled={saving}
                      style={{ alignSelf: "flex-start", padding: "6px 18px", fontSize: 12, fontWeight: 700,
                        background: "#C89A34", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer" }}>
                      {saving ? "Сохраняем…" : "Сохранить"}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
                <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Дата</th>
                <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Статус</th>
                <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Сумма</th>
                <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Менеджер</th>
                <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}>Позиции</th>
                <th style={{ ...TD, fontWeight: 600, color: "#8B7355" }}></th>
              </tr>
            </thead>
            <tbody>
              {active.orders.map(o => (
                <tr key={o.id} style={{ borderBottom: "1px solid #f0ece5" }}>
                  <td style={TD}>{o.deliveryDate ?? o.createdAt?.slice(0,10) ?? "—"}</td>
                  <td style={TD}>
                    <span style={{ background: statusColor(o.status) + "22",
                      color: statusColor(o.status), borderRadius: 5,
                      padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td style={{ ...TD, fontWeight: 600 }}>{fmtRub(o.totalKopecks)}</td>
                  <td style={{ ...TD, color: "#777" }}>{o.assignedManager ?? "—"}</td>
                  <td style={{ ...TD, color: "#555", fontSize: 11 }}
                    onClick={e => e.stopPropagation()}>
                    {expandedItems.has(o.id)
                      ? <div>
                          {o.items?.map((it, idx) => <div key={idx}>· {it.productName}</div>)}
                          <button
                            onClick={e => { e.stopPropagation(); setExpandedItems(prev => { const n = new Set(prev); n.delete(o.id); return n; }); }}
                            style={{ fontSize: 10, color: "#C89A34", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
                            ▲ Свернуть
                          </button>
                        </div>
                      : <span>
                          {o.items?.slice(0, 2).map(i => i.productName).join(", ")}
                          {(o.items?.length ?? 0) > 2 && (
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedItems(prev => { const n = new Set(prev); n.add(o.id); return n; }); }}
                              style={{ fontSize: 10, color: "#C89A34", background: "none", border: "none", cursor: "pointer", marginLeft: 4 }}>
                              +{(o.items?.length ?? 0) - 2} ▼
                            </button>
                          )}
                        </span>
                    }
                  </td>
                  <td style={TD} onClick={e => e.stopPropagation()}>
                    {(o.items?.length ?? 0) > 0 && (
                      <button onClick={() => setUpdOrder(o)}
                        style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
                          border: "1px solid rgba(200,154,52,.4)", background: "transparent",
                          color: "#8B6914", fontWeight: 600, whiteSpace: "nowrap" }}>
                        УПД
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ClientCalls phone={active.phone} />
          <ClientEmailSection email={active.email} clientName={active.name} businessId={businessId} />
          {active.email && <ClientMailings email={active.email} businessId={businessId} />}

          {/* Модалки */}
          {reconOpen && (
            <ReconciliationModal
              businessId={businessId}
              customerName={active.name}
              customerInn={contact?.inn || active.inn || undefined}
              customerAddr={contact?.address || active.address || undefined}
              email={contact?.email || active.email || undefined}
              onClose={() => setReconOpen(false)}
            />
          )}
          {updOrder && (
            <UpdModal
              orderNum={updOrder.id.slice(-6)}
              customerName={updOrder.customerName}
              customerInn={updOrder.customerInn ?? undefined}
              customerAddr={updOrder.address ?? undefined}
              items={toUpdItems(updOrder.items ?? [])}
              onClose={() => setUpdOrder(null)}
            />
          )}
        </div>
      ) : (
        // ── Список клиентов ──────────────────────────────────────────────────
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Поиск по имени, телефону, ИНН…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", fontSize: 13,
                border: "1px solid #e0d8cc", borderRadius: 8,
                background: "#faf8f4", boxSizing: "border-box" }}
            />
            <select
              value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
              style={{ padding: "8px 10px", fontSize: 13, border: "1px solid #e0d8cc",
                borderRadius: 8, background: "#faf8f4", color: cityFilter ? "#3A2E1E" : "#8B7355",
                minWidth: 140 }}
            >
              <option value="">Все города</option>
              {cities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 12, color: "#8B7355", marginBottom: 12 }}>
            {filtered.length} клиентов{cityFilter ? ` · ${cityFilter}` : ""}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map(c => {
              const newCnt = getNewCount(c);
              return (
                <div key={c.name}
                  onClick={() => setSelected(c.name)}
                  style={{ background: newCnt > 0 ? "rgba(200,154,52,.04)" : "#fff",
                    border: `1px solid ${newCnt > 0 ? "rgba(200,154,52,.5)" : "rgba(200,154,52,.2)"}`,
                    borderRadius: 10, padding: "12px 16px", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 12, transition: "border-color .15s", position: "relative" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#C89A34")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = newCnt > 0 ? "rgba(200,154,52,.5)" : "rgba(200,154,52,.2)")}
                >
                  {newCnt > 0 && (
                    <span style={{ position: "absolute", top: -6, right: -6,
                      background: "#C62828", color: "#fff", borderRadius: "50%",
                      fontSize: 10, fontWeight: 700, minWidth: 18, height: 18,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "0 4px", lineHeight: 1 }}>
                      {newCnt}
                    </span>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#3A2E1E" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#8B7355", marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {c.phone && <span>{c.phone}</span>}
                      {c.inn   && <span>ИНН {c.inn}</span>}
                      {getClientCity(c) && <span>📍 {getClientCity(c)}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#2E7D32" }}>
                      {fmtRub(c.totalKopecks)}
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>
                      {c.orders.length} заказ{c.orders.length === 1 ? "" : c.orders.length < 5 ? "а" : "ов"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
