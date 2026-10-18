import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, writeBatch, doc } from "firebase/firestore";
import { db } from "../../firebase";
import { fmtRub } from "../useOrders";

interface PL {
  id: string; productName: string; barcode: string | null;
  supplierName: string; supplierId: string; qty: number;
  unitCostKopecks: number; customerName: string; orderId: string; status: string;
}

interface MergedLine {
  ids: string[]; productName: string; barcode: string | null;
  qty: number; unitCostKopecks: number; customers: string[];
}

interface Group {
  key: string; supplierName: string; ordered: boolean; lines: MergedLine[];
  orderIds: string[];
}

const TH: React.CSSProperties = { textAlign: "left", padding: "5px 8px", color: "#8B7355", fontWeight: 600, fontSize: 11 };
const TD: React.CSSProperties = { padding: "5px 8px", fontSize: 12 };
const BTN: React.CSSProperties = { fontSize: 11, padding: "4px 10px", borderRadius: 6,
  border: "1px solid rgba(200,154,52,.4)", background: "transparent", color: "#8B6914", cursor: "pointer" };

function printOrder(g: Group, vis: MergedLine[]) {
  const date = new Date().toLocaleDateString("ru-RU");
  const rows = vis.map((l, i) =>
    `<tr><td>${i+1}</td><td>${l.productName}</td><td>${l.barcode ?? "—"}</td>` +
    `<td align="right">${l.qty}</td>` +
    `<td align="right">${(l.unitCostKopecks/100).toFixed(2)}</td>` +
    `<td align="right"><b>${(l.unitCostKopecks*l.qty/100).toFixed(2)}</b></td>` +
    `<td>${l.customers.join(", ")}</td></tr>`
  ).join("");
  const total = vis.reduce((s, l) => s + l.unitCostKopecks * l.qty, 0);
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;padding:32px;font-size:13px}
table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:6px;border:1px solid #ddd;text-align:left;font-size:11px}
td{padding:5px 6px;border:1px solid #eee}.tot{margin-top:14px;text-align:right;font-weight:700}
@media print{body{padding:16px}}</style></head><body>
<h2 style="margin:0 0 4px">ЗАКАЗ ПОСТАВЩИКУ: ${g.supplierName}</h2>
<p style="color:#666;font-size:12px;margin:0 0 16px">Дата: ${date}</p>
<table><thead><tr><th>№</th><th>Наименование</th><th>Штрихкод</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th><th>Для кого</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="tot">Итого: ${(total/100).toFixed(2)} ₽</div>
<script>window.print();<\/script></body></html>`);
  w.document.close();
}

function downloadXls(g: Group, vis: MergedLine[]) {
  const hdr = "№\tНаименование\tШтрихкод\tКол-во\tЦена (₽)\tСумма (₽)\tДля кого\n";
  const rows = vis.map((l, i) =>
    `${i+1}\t${l.productName}\t${l.barcode ?? ""}\t${l.qty}\t` +
    `${(l.unitCostKopecks/100).toFixed(2)}\t${(l.unitCostKopecks*l.qty/100).toFixed(2)}\t${l.customers.join("; ")}`
  ).join("\n");
  const blob = new Blob(["\uFEFF" + hdr + rows], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `Zakaz_${g.supplierName}_${new Date().toLocaleDateString("ru-RU").replace(/\./g,"-")}.xls`;
  a.click(); URL.revokeObjectURL(url);
}

export function PurchaseLinesSection({ businessId }: { businessId: string }) {
  const [groups, setGroups]   = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [emails,  setEmails]  = useState<Record<string, string>>({});
  const [paidSet, setPaidSet] = useState<Set<string>>(new Set());
  // local exclusions: supplierKey → set of MergedLine.ids[0]
  const [excl, setExcl] = useState<Record<string, Set<string>>>({});

  // load supplier emails (don't overwrite user edits)
  useEffect(() => {
    return onSnapshot(collection(db, `tenants/${businessId}/suppliers`), snap => {
      setEmails(prev => {
        const next = { ...prev };
        snap.docs.forEach(d => {
          const e = (d.data() as { email?: string }).email;
          if (e && !(d.id in next)) next[d.id] = e;
        });
        return next;
      });
    });
  }, [businessId]);

  useEffect(() => {
    const q = query(
      collection(db, `tenants/${businessId}/purchase_lines`),
      where("status", "in", ["pending", "ordered"]),
    );
    return onSnapshot(q, snap => {
      const raw = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<PL,"id">) }));
      const gMap: Record<string, { name: string; ordered: boolean; byProd: Record<string, MergedLine>; orderIds: Set<string> }> = {};
      for (const l of raw) {
        // Группируем по имени поставщика — supplierId может быть техническим ID или именем,
        // поэтому имя надёжнее как ключ группировки
        const key = (l.supplierName || l.supplierId || "unknown").toLowerCase().trim();
        if (!gMap[key]) gMap[key] = { name: l.supplierName || key, ordered: false, byProd: {}, orderIds: new Set() };
        if (l.status === "ordered") gMap[key].ordered = true;
        if (l.orderId) gMap[key].orderIds.add(l.orderId);
        const pk = l.barcode || l.productName;
        if (!gMap[key].byProd[pk]) {
          gMap[key].byProd[pk] = { ids: [], productName: l.productName, barcode: l.barcode,
            qty: 0, unitCostKopecks: l.unitCostKopecks, customers: [] };
        }
        const m = gMap[key].byProd[pk];
        m.ids.push(l.id);
        m.qty += l.qty;
        if (!m.customers.includes(l.customerName)) m.customers.push(l.customerName);
      }
      setGroups(Object.entries(gMap).map(([key, g]) => ({
        key, supplierName: g.name, ordered: g.ordered, lines: Object.values(g.byProd),
        orderIds: [...g.orderIds],
      })));
      setLoading(false);
    }, () => setLoading(false));
  }, [businessId]);

  async function markOrdered(g: Group) {
    const batch = writeBatch(db);
    g.lines.flatMap(l => l.ids).forEach(id =>
      batch.update(doc(db, `tenants/${businessId}/purchase_lines`, id), { status: "ordered" })
    );
    await batch.commit();
  }

  async function markReceived(g: Group) {
    const batch = writeBatch(db);
    g.lines.flatMap(l => l.ids).forEach(id =>
      batch.update(doc(db, `tenants/${businessId}/purchase_lines`, id), { status: "received" })
    );
    await batch.commit();
    setPaidSet(prev => { const s = new Set(prev); s.delete(g.key); return s; });
  }

  if (loading) return <div className="go-empty">Загрузка…</div>;
  if (!groups.length) return (
    <div className="go-empty">Нет позиций для закупки — нажмите «Закупить» в разделе Сборка</div>
  );

  return (
    <div>
      {groups.map(g => {
        const exSet = excl[g.key] ?? new Set<string>();
        const vis   = g.lines.filter(l => !exSet.has(l.ids[0]));
        const total = vis.reduce((s, l) => s + l.unitCostKopecks * l.qty, 0);
        const isPaid = paidSet.has(g.key);

        return (
          <div key={g.key} style={{ marginBottom: 28, border: "1px solid rgba(200,154,52,.25)", borderRadius: 10, overflow: "hidden" }}>

            {/* Header */}
            <div style={{ background: "rgba(200,154,52,.08)", padding: "10px 14px",
              display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#5A4A35", flex: 1 }}>{g.supplierName}</span>
              <span style={{ fontSize: 12, color: "#8B7355" }}>{fmtRub(total)}</span>
              <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={g.ordered}
                  onChange={() => { if (!g.ordered) void markOrdered(g); }} />
                Заказан
              </label>
              <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", cursor: "pointer",
                color: isPaid ? "#2E7D32" : undefined }}>
                <input type="checkbox" checked={isPaid}
                  onChange={() => {
                    if (!isPaid) {
                      setPaidSet(prev => new Set([...prev, g.key]));
                      if (g.ordered) void markReceived(g);
                    } else {
                      setPaidSet(prev => { const s = new Set(prev); s.delete(g.key); return s; });
                    }
                  }} />
                Оплачен
              </label>
              <button onClick={() => printOrder(g, vis)} style={BTN}>📄 PDF</button>
              <button onClick={() => downloadXls(g, vis)} style={BTN}>📊 Excel</button>
            </div>

            {/* Table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e0d8cc", background: "#faf8f4" }}>
                    <th style={TH}>Наименование</th>
                    <th style={TH}>Штрихкод</th>
                    <th style={{ ...TH, textAlign: "right" }}>Кол-во</th>
                    <th style={{ ...TH, textAlign: "right" }}>Цена, ₽</th>
                    <th style={{ ...TH, textAlign: "right" }}>Сумма, ₽</th>
                    <th style={TH}>Для кого</th>
                    <th style={{ width: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {vis.map(l => (
                    <tr key={l.ids[0]} style={{ borderBottom: "1px solid #f0ece5" }}>
                      <td style={TD}>{l.productName}</td>
                      <td style={{ ...TD, fontFamily: "monospace", fontSize: 11 }}>{l.barcode ?? "—"}</td>
                      <td style={{ ...TD, textAlign: "right" }}>{l.qty}</td>
                      <td style={{ ...TD, textAlign: "right" }}>{fmtRub(l.unitCostKopecks)}</td>
                      <td style={{ ...TD, textAlign: "right", fontWeight: 600 }}>{fmtRub(l.unitCostKopecks * l.qty)}</td>
                      <td style={{ ...TD, color: "#8B7355", fontSize: 11 }}>{l.customers.join(", ")}</td>
                      <td style={{ textAlign: "center" }}>
                        <button onClick={() => setExcl(prev => {
                          const s = new Set(prev[g.key] ?? []);
                          s.has(l.ids[0]) ? s.delete(l.ids[0]) : s.add(l.ids[0]);
                          return { ...prev, [g.key]: s };
                        })} style={{ background: "none", border: "none", color: "#C62828", cursor: "pointer", fontSize: 15 }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid #e0d8cc", background: "rgba(200,154,52,.06)" }}>
                    <td colSpan={5} style={{ ...TD, fontWeight: 700, color: "#5A4A35" }}>Итого по поставщику</td>
                    <td style={{ ...TD, textAlign: "right", fontWeight: 700, fontSize: 13, color: "#5A4A35" }}>{fmtRub(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Email row */}
            <div style={{ padding: "8px 14px", borderTop: "1px solid #f0ece5",
              display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#8B7355", whiteSpace: "nowrap" }}>Email:</span>
              <input type="email" value={emails[g.key] ?? ""}
                onChange={e => setEmails(prev => ({ ...prev, [g.key]: e.target.value }))}
                placeholder="email@supplier.ru"
                style={{ flex: 1, fontSize: 12, border: "none", borderBottom: "1px solid #e0d8cc",
                  background: "transparent", padding: "2px 4px", minWidth: 0 }} />
              <a href={emails[g.key]
                  ? `mailto:${emails[g.key]}?subject=Заказ ${encodeURIComponent(g.supplierName)}`
                  : undefined}
                style={{ ...BTN, textDecoration: "none", opacity: emails[g.key] ? 1 : 0.4,
                  pointerEvents: emails[g.key] ? "auto" : "none" }}>
                ✉ Написать
              </a>
            </div>
          </div>
        );
      })}

      {groups.length > 1 && (() => {
        const grandTotal = groups.reduce((s, g) => {
          const exSet = excl[g.key] ?? new Set<string>();
          return s + g.lines.filter(l => !exSet.has(l.ids[0])).reduce((a, l) => a + l.unitCostKopecks * l.qty, 0);
        }, 0);
        return (
          <div style={{ textAlign: "right", padding: "10px 14px", borderTop: "2px solid rgba(200,154,52,.4)",
            background: "rgba(200,154,52,.06)", borderRadius: 8, marginTop: -4 }}>
            <span style={{ fontSize: 13, color: "#5A4A35", fontWeight: 700 }}>
              Общая сумма закупки: {fmtRub(grandTotal)}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
