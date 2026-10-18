import { useState } from "react";
import { addDoc, collection, updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase";
import { type Order } from "../useOrders";
import { parseQty, parseRub, useNumDrafts } from "../numInput";
import "../orders.css";

interface InvoiceRow {
  name: string;
  qty: number;
  price: number;    // рублей
  confirmed: boolean;
}

interface Props {
  order: Order;
  businessId: string;
  onClose: () => void;
}

const PROXY_URL = "https://opentgp.ru/food/pay-proxy.php";

export function InvoiceModal({ order, businessId, onClose }: Props) {
  const [rows, setRows] = useState<InvoiceRow[]>(
    order.items.map((it) => ({
      name: it.productName,
      qty: it.quantity,
      price: it.unitPrice / 100,
      confirmed: true,          // цена из заказа — уже реальная
    }))
  );
  const [toEmail, setToEmail] = useState(order.email ?? "");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; num?: number; error?: string } | null>(null);
  const drafts = useNumDrafts();

  const subtotal = rows.reduce((s, r) => s + r.qty * r.price, 0);
  const vat      = subtotal * 0.22;
  const total    = subtotal + vat;
  const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

  function updateRow(i: number, patch: Partial<InvoiceRow>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function printVersion() {
    const date = new Date().toLocaleDateString("ru-RU");
    const rowsHtml = rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.name}</td><td style="text-align:right">${r.qty}</td>` +
      `<td style="text-align:right">${fmt(r.price)}</td><td style="text-align:right;font-weight:600">${fmt(r.qty * r.price)}</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Счёт — ${order.customerName}</title>
<style>
  body{font-family:Arial,sans-serif;padding:40px;font-size:13px;color:#1a1a1a}
  h2{margin:0 0 4px}
  .meta{color:#666;margin-bottom:20px;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #ddd;font-size:12px}
  td{padding:6px 10px;border:1px solid #eee}
  tfoot td{background:#f9f9f9;font-weight:700}
  .totals{margin-top:16px;text-align:right;font-size:13px;line-height:1.8}
  .total-big{font-size:16px;font-weight:700}
  @media print{body{padding:20px}}
</style></head><body>
<h2>СЧЁТ НА ОПЛАТУ</h2>
<div class="meta">Дата: ${date} · Покупатель: <strong>${order.customerName}</strong>${order.customerInn ? " · ИНН " + order.customerInn : ""}</div>
${order.address ? `<div class="meta">Адрес: ${order.address}</div>` : ""}
<table>
  <thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="totals">
  Без НДС: ${fmt(subtotal)} ₽<br>
  НДС 22%: ${fmt(vat)} ₽<br>
  <span class="total-big">Итого с НДС: ${fmt(total)} ₽</span>
</div>
<p style="margin-top:32px;font-size:12px;color:#666">Поставщик: ООО «ОпенТрейдГрупп» · ИНН 9703235411<br>
trade@opentgp.ru · +7 (495) 205-35-00</p>
<script>window.print();<\/script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  async function save() {
    if (drafts.anyInvalid) return;
    setSaving(true);
    try {
      const invData = {
        orderId: order.id,
        customerName: order.customerName,
        customerInn: order.customerInn ?? null,
        address: order.address ?? null,
        email: toEmail || null,
        rows: rows.map((r) => ({ name: r.name, qty: r.qty, price: r.price })),
        subtotal, vat, total,
        createdAt: new Date().toISOString(),
      };
      await addDoc(collection(db, `tenants/${businessId}/invoices`), invData);
      await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { status: "invoiced" });
      setResult({ ok: true });
    } catch (e) {
      console.error("Invoice save failed:", e);
      alert("Ошибка сохранения: " + String(e));
      setResult({ ok: false, error: String(e) });
    } finally {
      setSaving(false);
    }
  }

  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    if (drafts.anyInvalid) return;
    setDownloading(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Secret": "grp-proxy-2026",
          "X-Proxy-Path": "/crm-invoice-pdf",
        },
        body: JSON.stringify({
          buyer:      order.customerName,
          buyer_inn:  order.customerInn  ?? "",
          buyer_addr: order.address      ?? "",
          items: rows.map((r) => ({ name: r.name, qty: r.qty, price: r.price })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Schet_${order.customerName}_GustoRico.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Invoice PDF failed:", e);
      alert("Ошибка загрузки PDF: " + String(e));
    } finally {
      setDownloading(false);
    }
  }

  async function send() {
    if (!toEmail.trim() || drafts.anyInvalid) return;
    setSending(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Secret": "grp-proxy-2026",
          "X-Proxy-Path": "/crm-invoice",
        },
        body: JSON.stringify({
          buyer:      order.customerName,
          buyer_inn:  order.customerInn  ?? "",
          buyer_addr: order.address      ?? "",
          phone:      order.phone        ?? "",
          email:      toEmail.trim(),
          comment:    order.comment      ?? "",
          items: rows.map((r) => ({ name: r.name, qty: r.qty, price: r.price })),
        }),
      });
      const data = await res.json() as { ok: boolean; num?: number; error?: string };
      // Показываем результат сразу — независимо от Firestore
      setResult(data);
      if (data.ok) {
        // Сохраняем в Firestore при успешной отправке (не блокируем UI)
        try {
          await addDoc(collection(db, `tenants/${businessId}/invoices`), {
            orderId: order.id, customerName: order.customerName,
            customerInn: order.customerInn ?? null, email: toEmail,
            rows: rows.map((r) => ({ name: r.name, qty: r.qty, price: r.price })),
            subtotal, vat, total, num: data.num,
            createdAt: new Date().toISOString(),
          });
          await updateDoc(doc(db, `tenants/${businessId}/orders`, order.id), { status: "invoiced" });
        } catch (fsErr) {
          console.error("Invoice Firestore write failed:", fsErr);
        }
      }
    } catch (e) {
      console.error("Invoice send failed:", e);
      setResult({ ok: false, error: String(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 16px", overflowY: "auto" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 780, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,.2)" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Счёт — {order.customerName}</h2>
            {order.customerInn && <div style={{ fontSize: 12, color: "#8B7355", marginTop: 3 }}>ИНН {order.customerInn}</div>}
            {order.address && <div style={{ fontSize: 12, color: "#8B7355" }}>{order.address}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => void downloadPdf()} disabled={downloading || drafts.anyInvalid}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #C89A34",
                background: "#C89A34", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
              {downloading ? "Генерируем…" : "⬇ Скачать PDF"}
            </button>
            <button onClick={printVersion}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(200,154,52,.4)",
                background: "transparent", color: "#8B6914", cursor: "pointer" }}>
              Печать
            </button>
            <button onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#8B7355", lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Items */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 10 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e0d8cc" }}>
              <th style={{ textAlign: "left",  padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>Наименование</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, textTransform: "uppercase", width: 60 }}>Кол</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, textTransform: "uppercase", width: 110 }}>Цена, ₽</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, textTransform: "uppercase", width: 100 }}>Сумма, ₽</th>
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0ece5" }}>
                <td style={{ padding: "4px 8px" }}>
                  <input value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })}
                    style={{ width: "100%", border: "none", borderBottom: "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13, padding: "2px 0" }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input type="text" inputMode="decimal" value={drafts.value(`qty-${i}`, String(r.qty))}
                    onChange={(e) => {
                      const q = parseQty(e.target.value);
                      drafts.set(`qty-${i}`, e.target.value, q !== null);
                      if (q !== null) updateRow(i, { qty: q });
                    }}
                    onBlur={() => { if (!drafts.invalid(`qty-${i}`)) drafts.clear(`qty-${i}`); }}
                    style={{ width: 50, textAlign: "right", border: "none",
                      borderBottom: drafts.invalid(`qty-${i}`) ? "1px solid #C62828" : "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input type="text" inputMode="decimal" value={drafts.value(`price-${i}`, String(r.price))}
                    onChange={(e) => {
                      const p = parseRub(e.target.value, 0);
                      drafts.set(`price-${i}`, e.target.value, p !== null);
                      if (p !== null) updateRow(i, { price: p, confirmed: true });
                    }}
                    onBlur={() => { if (!drafts.invalid(`price-${i}`)) drafts.clear(`price-${i}`); }}
                    style={{ width: 90, textAlign: "right", border: "none",
                      borderBottom: drafts.invalid(`price-${i}`) ? "1px solid #C62828" : "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13,
                      color: r.confirmed ? "#1A1814" : "#C62828",
                      fontWeight: r.confirmed ? 400 : 600 }} />
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 500 }}>
                  {fmt(r.qty * r.price)}
                </td>
                <td>
                  <button onClick={() => { drafts.clearAll(); setRows((p) => p.filter((_, idx) => idx !== i)); }}
                    style={{ background: "none", border: "none", color: "#C62828", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={() => setRows((p) => [...p, { name: "", qty: 1, price: 0, confirmed: true }])}
          style={{ fontSize: 12, color: "#8B6914", background: "transparent",
            border: "1px dashed rgba(200,154,52,.4)", borderRadius: 6,
            padding: "4px 12px", cursor: "pointer", marginBottom: 18 }}>
          + Добавить строку
        </button>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ fontSize: 13 }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 20px", color: "#8B7355", textAlign: "right" }}>Без НДС:</td>
                <td style={{ padding: "3px 0", textAlign: "right", minWidth: 120, fontWeight: 500 }}>{fmt(subtotal)} ₽</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 20px", color: "#8B7355", textAlign: "right" }}>НДС 22%:</td>
                <td style={{ padding: "3px 0", textAlign: "right", color: "#8B7355" }}>{fmt(vat)} ₽</td>
              </tr>
              <tr style={{ borderTop: "2px solid #e0d8cc" }}>
                <td style={{ padding: "6px 20px", fontWeight: 700, textAlign: "right" }}>Итого с НДС:</td>
                <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, fontSize: 16 }}>{fmt(total)} ₽</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Result */}
        {result && (
          <div style={{ padding: 14, borderRadius: 8, marginBottom: 14,
            background: result.ok ? "rgba(46,125,50,.08)" : "rgba(198,40,40,.08)",
            border: `1px solid ${result.ok ? "rgba(46,125,50,.25)" : "rgba(198,40,40,.25)"}` }}>
            {result.ok
              ? <span style={{ color: "#2E7D32", fontWeight: 600 }}>✓ Счёт № {result.num} отправлен на {toEmail}</span>
              : <span style={{ color: "#C62828" }}>Ошибка: {result.error}</span>}
          </div>
        )}

        {/* Email + actions */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="go-field" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
            <label>Email получателя</label>
            <input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)}
              placeholder="email@company.ru" />
          </div>
          <button className="go-btn go-btn--gold" onClick={() => void send()}
            disabled={sending || !toEmail.trim() || drafts.anyInvalid}>
            {sending ? "Отправляем…" : "Отправить счёт"}
          </button>
          <button className="go-btn go-btn--green" onClick={() => void save()} disabled={saving || drafts.anyInvalid}>
            {saving ? "…" : "Сохранить"}
          </button>
          <button className="go-btn go-btn--outline" onClick={onClose}>Закрыть</button>
        </div>

        <div style={{ fontSize: 11, color: "#aaa", marginTop: 10 }}>
          Цены красным — из прайса (не отредактированы). Сохранение переводит заказ в статус «Счёт».
        </div>
      </div>
    </div>
  );
}
