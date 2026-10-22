import { useState } from "react";
import "../orders.css";
import { parseQty, parseRub, useNumDrafts } from "../numInput";
import { splitVat, fmtKop } from "../money";
import { authHeader } from "../idToken";

export interface UpdItem {
  name: string;
  qty: number;
  unit: string;
  price: number;  // рублей, с НДС
  totalKopecks?: number;  // итог строки с НДС из заказа; сбрасывается при правке кол-ва/цены
  selected: boolean;
}

interface Props {
  orderNum?: string;
  customerName: string;
  customerInn?: string;
  customerAddr?: string;
  items: UpdItem[];
  onClose: () => void;
  onShip?: () => void;   // вызывается после успешной генерации (из сборки)
}

const PROXY_URL = "https://opentgp.ru/food/pay-proxy.php";

// Итог строки берём из исходной цены до округления: вызывающие передают totalKopecks/(qty*100),
// и так строка совпадает с заказом до копейки, а цена показывается без хвоста 3.3333333333333335.
function normalize(it: UpdItem): UpdItem {
  const totalKopecks = it.totalKopecks ?? Math.round(it.qty * it.price * 100);
  return { ...it, price: Math.round(it.price * 100) / 100, totalKopecks };
}

function lineTotal(it: UpdItem): number {
  return it.totalKopecks ?? Math.round(it.qty * Math.round(it.price * 100));
}

export function UpdModal({ orderNum, customerName, customerInn, customerAddr, items: initItems, onClose, onShip }: Props) {
  const [items, setItems] = useState<UpdItem[]>(() => initItems.map(normalize));
  const [stamp, setStamp] = useState(true);
  const [toEmail, setToEmail] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; num?: number; error?: string } | null>(null);

  const drafts = useNumDrafts();

  const selected = items.filter(it => it.selected);
  // Сумма заказа уже с НДС 22% — выделяем НДС изнутри
  const sums = splitVat(selected.map(lineTotal));

  function toggle(i: number) {
    setItems(p => p.map((it, idx) => idx === i ? { ...it, selected: !it.selected } : it));
  }
  function updateItem(i: number, patch: Partial<UpdItem>) {
    const repriced = "qty" in patch || "price" in patch;
    setItems(p => p.map((it, idx) => idx === i ? { ...it, ...patch, ...(repriced ? { totalKopecks: undefined } : {}) } : it));
  }
  function toggleAll() {
    const allSel = items.every(it => it.selected);
    setItems(p => p.map(it => ({ ...it, selected: !allSel })));
  }

  function buildPayload(email?: string) {
    // Сервер (upd_gen_v2.py): price_rub = item['price'] / 100  →  нужны копейки без НДС
    // НДС сервер считает сам: subtotal * VAT_RATE (22%). Поля sum/total/vat на уровне запроса игнорирует.
    return {
      buyer:      customerName,
      buyer_inn:  customerInn  ?? "",
      buyer_addr: customerAddr ?? "",
      stamp,
      email: email ?? "",
      items: selected.map((it, i) => ({
        name: it.name, qty: it.qty, unit: it.unit,
        price: Math.round(sums.lines[i].net / it.qty), // копейки без НДС за единицу
      })),
    };
  }

  async function downloadPdf() {
    if (!selected.length || drafts.anyInvalid) return;
    setDownloading(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-upd", ...(await authHeader()) },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `UPD_${customerName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setResult({ ok: true });
      onShip?.();
    } catch (e) {
      console.error("UPD PDF failed:", e);
      setResult({ ok: false, error: String(e) });
    } finally {
      setDownloading(false);
    }
  }

  async function send() {
    if (!toEmail.trim() || !selected.length || drafts.anyInvalid) return;
    setSending(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Proxy-Secret": "grp-proxy-2026", "X-Proxy-Path": "/crm-upd", ...(await authHeader()) },
        body: JSON.stringify(buildPayload(toEmail.trim())),
      });
      const data = await res.json() as { ok: boolean; num?: number; error?: string };
      setResult(data);
      if (data.ok) onShip?.();
    } catch (e) {
      console.error("UPD send failed:", e);
      setResult({ ok: false, error: String(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1200,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 16px", overflowY: "auto" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 820, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,.2)" }}
        onClick={e => e.stopPropagation()}>

        {/* Шапка */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              УПД — {customerName}
            </h2>
            <div style={{ fontSize: 12, color: "#8B7355", marginTop: 3 }}>
              Универсальный передаточный документ · Форма ФНС ММВ-20-3/96@
              {customerInn && ` · ИНН ${customerInn}`}
            </div>
            {orderNum && <div style={{ fontSize: 11, color: "#aaa" }}>Заказ {orderNum}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Переключатель печати */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8B7355", cursor: "pointer" }}>
              <input type="checkbox" checked={stamp} onChange={e => setStamp(e.target.checked)}
                style={{ width: 14, height: 14, cursor: "pointer" }} />
              Печать
            </label>
            <button onClick={() => void downloadPdf()} disabled={downloading || !selected.length || drafts.anyInvalid}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #C89A34",
                background: "#C89A34", color: "#fff", cursor: "pointer", fontWeight: 600,
                opacity: selected.length ? 1 : 0.5 }}>
              {downloading ? "Генерируем…" : "⬇ Скачать УПД"}
            </button>
            <button onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#8B7355" }}>✕</button>
          </div>
        </div>

        {/* Таблица позиций */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 10 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e0d8cc" }}>
              <th style={{ padding: "4px 8px", width: 32 }}>
                <input type="checkbox"
                  checked={items.length > 0 && items.every(it => it.selected)}
                  onChange={toggleAll}
                  style={{ cursor: "pointer" }} />
              </th>
              <th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600 }}>Наименование</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, width: 70 }}>Кол-во</th>
              <th style={{ textAlign: "center", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, width: 60 }}>Ед.</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, width: 110 }}>Цена, ₽</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#8B7355", fontSize: 11, fontWeight: 600, width: 110 }}>Сумма с НДС</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0ece5",
                background: it.selected ? "rgba(200,154,52,.04)" : undefined,
                opacity: it.selected ? 1 : 0.45 }}>
                <td style={{ padding: "4px 8px", textAlign: "center" }}>
                  <input type="checkbox" checked={it.selected} onChange={() => toggle(i)}
                    style={{ cursor: "pointer" }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input value={it.name} onChange={e => updateItem(i, { name: e.target.value })}
                    style={{ width: "100%", border: "none", borderBottom: "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input type="text" inputMode="decimal" value={drafts.value(`qty-${i}`, String(it.qty))}
                    onChange={e => {
                      const q = parseQty(e.target.value);
                      drafts.set(`qty-${i}`, e.target.value, q !== null);
                      if (q !== null) updateItem(i, { qty: q });
                    }}
                    onBlur={() => { if (!drafts.invalid(`qty-${i}`)) drafts.clear(`qty-${i}`); }}
                    style={{ width: 60, textAlign: "right", border: "none",
                      borderBottom: drafts.invalid(`qty-${i}`) ? "1px solid #C62828" : "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input value={it.unit} onChange={e => updateItem(i, { unit: e.target.value })}
                    style={{ width: 50, textAlign: "center", border: "none", borderBottom: "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input type="text" inputMode="decimal" value={drafts.value(`price-${i}`, String(it.price))}
                    onChange={e => {
                      const p = parseRub(e.target.value, 0);
                      drafts.set(`price-${i}`, e.target.value, p !== null);
                      if (p !== null) updateItem(i, { price: p });
                    }}
                    onBlur={() => { if (!drafts.invalid(`price-${i}`)) drafts.clear(`price-${i}`); }}
                    style={{ width: 90, textAlign: "right", border: "none",
                      borderBottom: drafts.invalid(`price-${i}`) ? "1px solid #C62828" : "1px solid #e0d8cc",
                      background: "transparent", fontSize: 13 }} />
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 500, color: "#8B7355" }}>
                  {fmtKop(lineTotal(it))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Итоги */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ fontSize: 13 }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 20px", color: "#8B7355", textAlign: "right" }}>Без НДС:</td>
                <td style={{ padding: "3px 0", textAlign: "right", minWidth: 130, fontWeight: 500 }}>{fmtKop(sums.net)} ₽</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 20px", color: "#8B7355", textAlign: "right" }}>в т.ч. НДС 22%:</td>
                <td style={{ padding: "3px 0", textAlign: "right", color: "#8B7355" }}>{fmtKop(sums.vat)} ₽</td>
              </tr>
              <tr style={{ borderTop: "2px solid #e0d8cc" }}>
                <td style={{ padding: "6px 20px", fontWeight: 700, textAlign: "right" }}>Итого к оплате:</td>
                <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, fontSize: 16 }}>{fmtKop(sums.total)} ₽</td>
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
              ? <span style={{ color: "#2E7D32", fontWeight: 600 }}>
                  ✓ УПД{result.num ? ` № ${result.num}` : ""} сформирован{toEmail ? ` · отправлен на ${toEmail}` : ""}
                </span>
              : <span style={{ color: "#C62828" }}>Ошибка: {result.error}</span>}
          </div>
        )}

        {/* Email + кнопки */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="go-field" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
            <label>Email покупателю (необязательно)</label>
            <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
              placeholder="email@company.ru" />
          </div>
          <button className="go-btn go-btn--gold" onClick={() => void send()}
            disabled={sending || !toEmail.trim() || !selected.length || drafts.anyInvalid}>
            {sending ? "Отправляем…" : "Отправить УПД"}
          </button>
          <button className="go-btn go-btn--outline" onClick={onClose}>Закрыть</button>
        </div>

        <div style={{ fontSize: 11, color: "#aaa", marginTop: 10 }}>
          Отметьте позиции для включения в УПД · Цены редактируемые · Печать — опционально
        </div>
      </div>
    </div>
  );
}
