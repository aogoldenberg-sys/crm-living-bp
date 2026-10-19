import { useState, useEffect, useRef } from "react";
import { doc, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase";
import { ClientEmailSection } from "./ClientEmailSection";
import { PhoneButton } from "../../telephony/PhoneButton";
import { MATRIX_WORKER_URL } from "../../telephony/config";

export interface Sup {
  id: string; name: string; cat: string; icon: string;
  contact?: string; phone?: string; email?: string;
  conditions?: string; paymentTerms?: string; hasContract?: boolean;
  status?: string; section?: string; assortment?: string;
  sheetName?: string; sheetUrl?: string | null; notes?: string;
  // документы
  contractUrl?: string | null; contractName?: string | null;
  pricelistFileUrl?: string | null; pricelistFileName?: string | null;
}

const SHEET_ID = "1BqrvyxXYUDT-wmBC0RR1Xnz_29hPIn6FNgrMFKhs-uA";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "_").slice(0, 30);
}

// ── Calls ─────────────────────────────────────────────────────────────────────
interface CallRecord {
  uid: string; type: string; client: string; account: string;
  via: string; start: string; wait: number; duration: number; record: string | null;
}
function normPhone(p: string) { return p.replace(/\D/g, "").slice(-10); }
function fmtCallDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fmtDur(sec: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}м ${s}с` : `${s}с`;
}
const CALL_TYPE: Record<string, { label: string; color: string }> = {
  in: { label: "↙ Входящий", color: "#1565C0" },
  out: { label: "↗ Исходящий", color: "#2E7D32" },
  missed: { label: "✗ Пропущен", color: "#C62828" },
};

function SupplierCalls({ phone }: { phone: string }) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const TD: React.CSSProperties = { padding: "5px 10px", fontSize: 12, verticalAlign: "middle" };

  useEffect(() => {
    if (!phone) { setLoading(false); return; }
    const norm = normPhone(phone);
    setLoading(true);
    fetch(`${MATRIX_WORKER_URL}/history?period=this_month&type=all`)
      .then(r => r.ok ? r.json() as Promise<CallRecord[]> : [])
      .then(data => setCalls(data.filter(c => normPhone(c.client) === norm)))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [phone]);

  if (!phone) return <div style={{ color: "#aaa", fontSize: 12, padding: "12px 0" }}>Телефон не указан — добавьте на вкладке «Данные»</div>;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8B7355", marginBottom: 8 }}>
        {loading ? "Загрузка…" : `За месяц · ${calls.length} звонков`}
      </div>
      {!loading && calls.length === 0 && <div style={{ fontSize: 12, color: "#aaa" }}>Звонков не найдено</div>}
      {!loading && calls.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
              {["Тип", "Дата", "Менеджер", "Длит.", "Запись"].map(h =>
                <th key={h} style={{ ...TD, fontWeight: 600, color: "#8B7355", fontSize: 11 }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => {
              const meta = CALL_TYPE[c.type] ?? { label: c.type, color: "#777" };
              return (
                <tr key={c.uid || i} style={{ borderBottom: "1px solid #f0ece5" }}>
                  <td style={TD}><span style={{ color: meta.color, fontWeight: 600, fontSize: 11 }}>{meta.label}</span></td>
                  <td style={{ ...TD, color: "#555", whiteSpace: "nowrap" }}>{fmtCallDate(c.start)}</td>
                  <td style={{ ...TD, color: "#8B7355" }}>{c.account || "—"}</td>
                  <td style={TD}>{fmtDur(c.duration)}</td>
                  <td style={TD}>
                    {c.record?.trim().startsWith("http")
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

// ── FileUploader ───────────────────────────────────────────────────────────────
function FileRow({ label, url, fileName, accept, onUploaded }:
  { label: string; url?: string | null; fileName?: string | null; accept: string; onUploaded: (url: string, name: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      const path = `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Zа-яёА-ЯЁ0-9._-]/g, "_")}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const downloadUrl = await getDownloadURL(sRef);
      onUploaded(downloadUrl, file.name);
    } catch (ex) {
      setErr("Ошибка загрузки: " + String(ex));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div style={{ padding: "12px 14px", background: "#faf8f4", borderRadius: 10,
      border: "1px solid #e8dfc8", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#3d2e1a", minWidth: 100 }}>{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"
          style={{ fontSize: 12, color: "#1565C0", textDecoration: "none", flex: 1 }}>
          📄 {fileName ?? "Скачать"}
        </a>
      ) : (
        <span style={{ fontSize: 12, color: "#aaa", flex: 1 }}>Файл не загружен</span>
      )}
      <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }} onChange={upload} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{ padding: "5px 12px", fontSize: 11, borderRadius: 7, cursor: "pointer",
          border: "1px solid rgba(200,154,52,.4)", background: "transparent", color: "#8B6914", whiteSpace: "nowrap" }}>
        {uploading ? "…" : url ? "Заменить" : "Загрузить"}
      </button>
      {err && <span style={{ fontSize: 11, color: "#C62828", width: "100%" }}>{err}</span>}
    </div>
  );
}

// ── SupplierModal ──────────────────────────────────────────────────────────────
type Tab = "data" | "comms" | "docs";

interface Props { sup: Sup | null; businessId: string; onClose: () => void }

export function SupplierModal({ sup, businessId, onClose }: Props) {
  const isNew = !sup?.id;
  const [form, setForm] = useState<Partial<Sup>>(sup ?? { section: "current", hasContract: false });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("data");

  const f = (k: keyof Sup, v: string | boolean | null) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const id = form.id ?? slugify(form.name ?? "supplier");
      await setDoc(doc(db, `tenants/${businessId}/suppliers`, id), { ...form, id });
      onClose();
    } catch (e) {
      console.error("save supplier:", e);
      alert("Ошибка сохранения. Проверьте подключение.");
    } finally {
      setSaving(false);
    }
  }

  const sheetUrl = form.sheetUrl || (form.sheetName ? `${SHEET_URL}#gid=0&sheet=${encodeURIComponent(form.sheetName)}` : null);

  const textFields: [keyof Sup, string, boolean][] = [
    ["name", "Название", false], ["cat", "Категория", false],
    ["contact", "Контакт (ФИО)", false], ["phone", "Телефон", false],
    ["email", "Email", false], ["conditions", "Условия поставки", true],
    ["paymentTerms", "Оплата / отсрочка", false], ["assortment", "Ассортимент", true],
    ["notes", "Примечания", true],
  ];

  const TABS: { id: Tab; label: string }[] = [
    { id: "data", label: "Данные" },
    { id: "comms", label: "Общение" },
    { id: "docs", label: "Документы" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "32px 16px", overflowY: "auto" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 640, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,.2)" }}
        onClick={e => e.stopPropagation()}>

        {/* Шапка */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {isNew ? "Новый поставщик" : form.name}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#8B7355" }}>✕</button>
        </div>

        {/* Табы */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #f0ece5" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "6px 16px", fontSize: 13, border: "none", cursor: "pointer",
                background: "none", fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? "#C89634" : "#8B7355",
                borderBottom: tab === t.id ? "2px solid #C89634" : "2px solid transparent",
                marginBottom: -2, transition: "color .15s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Вкладка Данные */}
        {tab === "data" && (
          <>
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: "#8B6914", textDecoration: "none", display: "inline-flex",
                  alignItems: "center", gap: 6, padding: "4px 10px", background: "rgba(200,154,52,.08)",
                  borderRadius: 8, border: "1px solid rgba(200,154,52,.25)", marginBottom: 14 }}>
                📊 Прайс-лист → Google Sheets {form.sheetName ? `· ${form.sheetName.split(" — ")[0]}` : ""}
              </a>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {textFields.map(([k, label, wide]) => (
                <div key={k} className="go-field" style={{ marginBottom: 0, gridColumn: wide ? "1/-1" : undefined }}>
                  <label>{label}</label>
                  <input value={(form[k] as string) ?? ""} onChange={e => f(k, e.target.value)} />
                </div>
              ))}
              <div className="go-field" style={{ marginBottom: 0, gridColumn: "1/-1" }}>
                <label>Лист Google Sheets (служебное)</label>
                <input value={(form.sheetName as string) ?? ""} onChange={e => f("sheetName", e.target.value)}
                  style={{ fontSize: 11, color: "#8B7355" }} />
              </div>
              <div className="go-field" style={{ marginBottom: 0 }}>
                <label>Договор</label>
                <select value={form.hasContract ? "yes" : "no"} onChange={e => f("hasContract", e.target.value === "yes")}>
                  <option value="no">❌ Нет</option>
                  <option value="yes">✅ Есть</option>
                </select>
              </div>
              <div className="go-field" style={{ marginBottom: 0 }}>
                <label>Статус работы</label>
                <select value={form.section ?? "current"} onChange={e => f("section", e.target.value)}>
                  <option value="current">Работаем</option>
                  <option value="new">Новый</option>
                  <option value="paused">Пауза</option>
                </select>
              </div>
            </div>

            {isNew && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(200,154,52,.07)",
                border: "1px solid rgba(200,154,52,.25)", borderRadius: 8, fontSize: 12, color: "#8B6914" }}>
                ℹ️ Товары поставщика появятся в поиске только после добавления листа в Google Sheets и обновления прайс-файла.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="go-btn go-btn--gold" onClick={() => void save()} disabled={saving || !form.name}>
                {saving ? "…" : "Сохранить"}
              </button>
              <button className="go-btn go-btn--outline" onClick={onClose}>Отмена</button>
            </div>
          </>
        )}

        {/* Вкладка Общение */}
        {tab === "comms" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#3A2E1E" }}>📞 Звонки</span>
                {form.phone && (
                  <PhoneButton phone={form.phone} extension={null} size={13} />
                )}
                {form.phone && (
                  <a href={`https://wa.me/${form.phone.replace(/\D/g, "")}`}
                    target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, padding: "2px 10px", borderRadius: 6, textDecoration: "none",
                      background: "rgba(37,211,102,.12)", color: "#128C7E",
                      border: "1px solid rgba(37,211,102,.35)", whiteSpace: "nowrap" }}>
                    WhatsApp
                  </a>
                )}
              </div>
              <SupplierCalls phone={form.phone ?? ""} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#3A2E1E", marginBottom: 4 }}>✉ Переписка</div>
              {form.email ? (
                <ClientEmailSection
                  email={form.email}
                  clientName={form.name ?? ""}
                  businessId={businessId}
                />
              ) : (
                <div style={{ color: "#aaa", fontSize: 12, padding: "12px 0" }}>
                  Email не указан — добавьте на вкладке «Данные»
                </div>
              )}
            </div>
          </div>
        )}

        {/* Вкладка Документы */}
        {tab === "docs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "#8B7355", marginBottom: 4 }}>
              Файлы загружаются в Firebase Storage и сохраняются в карточке поставщика.
            </div>
            <FileRow
              label="📃 Договор"
              url={form.contractUrl}
              fileName={form.contractName}
              accept=".pdf,.doc,.docx"
              onUploaded={(url, name) => {
                f("contractUrl", url); f("contractName", name); f("hasContract", true);
                void setDoc(doc(db, `tenants/${businessId}/suppliers`, form.id ?? slugify(form.name ?? "")),
                  { contractUrl: url, contractName: name, hasContract: true }, { merge: true });
              }}
            />
            <FileRow
              label="📊 Прайс-лист"
              url={form.pricelistFileUrl}
              fileName={form.pricelistFileName}
              accept=".pdf,.xls,.xlsx,.csv"
              onUploaded={(url, name) => {
                f("pricelistFileUrl", url); f("pricelistFileName", name);
                void setDoc(doc(db, `tenants/${businessId}/suppliers`, form.id ?? slugify(form.name ?? "")),
                  { pricelistFileUrl: url, pricelistFileName: name }, { merge: true });
              }}
            />
            <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(200,154,52,.06)",
              borderRadius: 8, border: "1px solid rgba(200,154,52,.2)", fontSize: 12, color: "#8B6914" }}>
              💡 Прайс в формате Google Sheets настраивается на вкладке «Данные» (поле «Лист Google Sheets»).
              Здесь — оригинальный файл от поставщика (PDF / Excel).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
