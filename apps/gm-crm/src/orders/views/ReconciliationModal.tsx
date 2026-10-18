import { useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub } from "../useOrders";
import "../orders.css";

interface ReconRow {
  date: string;
  doc: string;
  debit: number;   // отгрузка (рублей)
  credit: number;  // оплата (рублей)
}

interface Props {
  businessId: string;
  customerName: string;
  customerInn?: string;
  customerAddr?: string;
  email?: string;            // email клиента — подставляется в поле отправки
  orderId?: string;          // для фильтрации платежей
  onClose: () => void;
}

const PROXY_URL = "https://opentgp.ru/food/pay-proxy.php";

export function ReconciliationModal({ businessId, customerName, customerInn, customerAddr, email, orderId, onClose }: Props) {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [toEmail, setToEmail] = useState(email ?? "");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const today = new Date().toLocaleDateString("ru-RU");
  const monthAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString("ru-RU");
  const [periodFrom, setPeriodFrom] = useState(monthAgo);
  const [periodTo, setPeriodTo]   = useState(today);

  const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

  async function loadFromFirestore() {
    setLoading(true);
    try {
      const loaded: ReconRow[] = [];

      // Заказы клиента = дебет (отгрузка)
      const oSnap = await getDocs(
        query(collection(db, `tenants/${businessId}/orders`),
              where("customerName", "==", customerName))
      );
      oSnap.docs.forEach(d => {
        const o = d.data() as { createdAt?: string; status?: string; totalKopecks?: number; items?: {unitPrice:number;quantity:number}[] };
        if (!o.createdAt) return;
        const total = o.totalKopecks
          ? o.totalKopecks / 100
          : (o.items ?? []).reduce((s, it) => s + it.unitPrice * it.quantity / 100, 0);
        if (total > 0) {
          loaded.push({
            date: new Date(o.createdAt).toLocaleDateString("ru-RU"),
            doc: `Заказ ${d.id.slice(-6)}`,
            debit: Math.round(total * 100) / 100,
            credit: 0,
          });
        }
      });

      // Платежи клиента = кредит
      // Payment documents have: amount (kopecks), payerName, payerInn, txDate, purpose, orderId
      const orderIds = oSnap.docs.map(d => d.id).filter(Boolean);

      // Шаг 1: платежи привязанные к заказам клиента (orderId in [...])
      const paymentDocs: import("firebase/firestore").QueryDocumentSnapshot[] = [];
      for (let i = 0; i < orderIds.length; i += 10) {
        const chunk = orderIds.slice(i, i + 10);
        const pSnap = await getDocs(
          query(collection(db, `tenants/${businessId}/payments`),
                where("orderId", "in", chunk))
        );
        pSnap.docs.forEach(d => paymentDocs.push(d));
      }

      // Шаг 2: платежи по имени плательщика (unmatched платежи)
      const byNameSnap = await getDocs(
        query(collection(db, `tenants/${businessId}/payments`),
              where("payerName", "==", customerName))
      );
      byNameSnap.docs.forEach(d => {
        if (!paymentDocs.some(x => x.id === d.id)) paymentDocs.push(d);
      });

      paymentDocs.forEach(d => {
        const p = d.data() as { txDate?: string; createdAt?: string; amount?: number; purpose?: string; payerName?: string };
        const amtRub = (p.amount ?? 0) / 100;
        if (amtRub <= 0) return;
        loaded.push({
          date: new Date(p.txDate ?? p.createdAt ?? "").toLocaleDateString("ru-RU"),
          doc: p.purpose || `Оплата`,
          debit: 0,
          credit: Math.round(amtRub * 100) / 100,
        });
      });

      // Сортируем по дате
      loaded.sort((a, b) => {
        const parse = (s: string) => {
          const [d, m, y] = s.split(".");
          return new Date(+y, +m - 1, +d).getTime();
        };
        return parse(a.date) - parse(b.date);
      });

      setRows(loaded);
    } catch (e) {
      alert("Ошибка загрузки: " + String(e));
    }
    setLoading(false);
  }

  function addRow() {
    setRows(p => [...p, { date: today, doc: "", debit: 0, credit: 0 }]);
  }

  function updateRow(i: number, patch: Partial<ReconRow>) {
    setRows(p => p.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  const debitTotal  = rows.reduce((s, r) => s + r.debit, 0);
  const creditTotal = rows.reduce((s, r) => s + r.credit, 0);
  const balance     = debitTotal - creditTotal;

  function buildPayload(email?: string) {
    return {
      buyer:       customerName,
      buyer_inn:   customerInn  ?? "",
      buyer_addr:  customerAddr ?? "",
      period_from: periodFrom,
      period_to:   periodTo,
      balance_start: 0,
      email: email ?? "",
      rows: rows.map(r => ({ date: r.date, doc: r.doc, debit: r.debit, credit: r.credit })),
    };
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-reconciliation" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Akt_sverki_${customerName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Ошибка PDF: " + String(e));
    }
    setDownloading(false);
  }

  async function send() {
    if (!toEmail.trim()) return;
    setSending(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-reconciliation" },
        body: JSON.stringify(buildPayload(toEmail.trim())),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      setResult(data);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    }
    setSending(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1100,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 16px", overflowY: "auto" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 820, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,.2)" }}
        onClick={e => e.stopPropagation()}>

        {/* Шапка */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Акт сверки — {customerName}</h2>
            {customerInn && <div style={{ fontSize: 12, color: "#8B7355", marginTop: 3 }}>ИНН {customerInn}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => void downloadPdf()} disabled={downloading || rows.length === 0}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #C89A34",
                background: "#C89A34", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
              {downloading ? "Генерируем…" : "⬇ Скачать PDF"}
            </button>
            <button onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#8B7355" }}>✕</button>
          </div>
        </div>

        {/* Период */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, color: "#8B7355", display: "block" }}>Период с</label>
            <input value={periodFrom} onChange={e => setPeriodFrom(e.target.value)}
              style={{ fontSize: 13, border: "1px solid #e0d8cc", borderRadius: 6, padding: "4px 8px", width: 110 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#8B7355", display: "block" }}>по</label>
            <input value={periodTo} onChange={e => setPeriodTo(e.target.value)}
              style={{ fontSize: 13, border: "1px solid #e0d8cc", borderRadius: 6, padding: "4px 8px", width: 110 }} />
          </div>
          <button onClick={() => void loadFromFirestore()} disabled={loading}
            style={{ fontSize: 12, padding: "6px 14px", borderRadius: 7, border: "1px solid rgba(200,154,52,.4)",
              background: "transparent", color: "#8B6914", cursor: "pointer", marginTop: 14 }}>
            {loading ? "Загрузка…" : "⟳ Загрузить из CRM"}
          </button>
        </div>

        {/* Таблица операций */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 10 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e0d8cc" }}>
              <th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, width: 100 }}>Дата</th>
              <th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600 }}>Документ</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#C62828", fontSize: 11, fontWeight: 600, width: 120 }}>Отгрузка, ₽</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#2E7D32", fontSize: 11, fontWeight: 600, width: 120 }}>Оплата, ₽</th>
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "16px 8px", color: "#aaa", textAlign: "center", fontSize: 12 }}>
                Нажмите «Загрузить из CRM» или добавьте строки вручную
              </td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0ece5" }}>
                <td style={{ padding: "4px 8px" }}>
                  <input value={r.date} onChange={e => updateRow(i, { date: e.target.value })}
                    style={{ width: 90, border: "none", borderBottom: "1px solid #e0d8cc", background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input value={r.doc} onChange={e => updateRow(i, { doc: e.target.value })}
                    style={{ width: "100%", border: "none", borderBottom: "1px solid #e0d8cc", background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input type="number" step={0.01} min={0} value={r.debit || ""}
                    onChange={e => updateRow(i, { debit: Number(e.target.value) || 0 })}
                    style={{ width: 100, textAlign: "right", border: "none", borderBottom: "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13, color: "#C62828" }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input type="number" step={0.01} min={0} value={r.credit || ""}
                    onChange={e => updateRow(i, { credit: Number(e.target.value) || 0 })}
                    style={{ width: 100, textAlign: "right", border: "none", borderBottom: "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13, color: "#2E7D32" }} />
                </td>
                <td>
                  <button onClick={() => setRows(p => p.filter((_, idx) => idx !== i))}
                    style={{ background: "none", border: "none", color: "#C62828", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={addRow}
          style={{ fontSize: 12, color: "#8B6914", background: "transparent", border: "1px dashed rgba(200,154,52,.4)",
            borderRadius: 6, padding: "4px 12px", cursor: "pointer", marginBottom: 18 }}>
          + Добавить строку
        </button>

        {/* Итоги */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ fontSize: 13 }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 20px", color: "#C62828", textAlign: "right" }}>Отгружено:</td>
                <td style={{ padding: "3px 0", textAlign: "right", minWidth: 130, fontWeight: 500, color: "#C62828" }}>{fmt(debitTotal)} ₽</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 20px", color: "#2E7D32", textAlign: "right" }}>Оплачено:</td>
                <td style={{ padding: "3px 0", textAlign: "right", color: "#2E7D32" }}>{fmt(creditTotal)} ₽</td>
              </tr>
              <tr style={{ borderTop: "2px solid #e0d8cc" }}>
                <td style={{ padding: "6px 20px", fontWeight: 700, textAlign: "right" }}>
                  {balance > 0 ? "Долг покупателя:" : balance < 0 ? "Переплата:" : "Баланс:"}
                </td>
                <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, fontSize: 16,
                  color: balance > 0 ? "#C62828" : balance < 0 ? "#2E7D32" : "#1A1814" }}>
                  {fmt(Math.abs(balance))} ₽
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Результат */}
        {result && (
          <div style={{ padding: 14, borderRadius: 8, marginBottom: 14,
            background: result.ok ? "rgba(46,125,50,.08)" : "rgba(198,40,40,.08)",
            border: `1px solid ${result.ok ? "rgba(46,125,50,.25)" : "rgba(198,40,40,.25)"}` }}>
            {result.ok
              ? <span style={{ color: "#2E7D32", fontWeight: 600 }}>✓ Акт сверки отправлен на {toEmail}</span>
              : <span style={{ color: "#C62828" }}>Ошибка: {result.error}</span>}
          </div>
        )}

        {/* Email + кнопки */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="go-field" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
            <label>Email получателя</label>
            <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
              placeholder="email@company.ru" />
          </div>
          <button className="go-btn go-btn--gold" onClick={() => void send()}
            disabled={sending || !toEmail.trim() || rows.length === 0}>
            {sending ? "Отправляем…" : "Отправить акт"}
          </button>
          <button className="go-btn go-btn--outline" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
