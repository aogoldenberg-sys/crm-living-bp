import { useState, useRef } from "react";
import { collection, doc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { loadPricelist, normalizeBarcode } from "../useOrders";
import { parseCsv } from "../bankCsv";
import { parseQty, rubToKopecks } from "../numInput";

interface ReceiptRow {
  _id: string;
  productName: string;
  barcode: string;
  qty: string;
  unit: string;
  costRub: string;
}

interface Props {
  businessId: string;
  currentUser: string;
  region?: string;
  suppliers: string[];
  onSaved: () => void;
  onCancel: () => void;
}

const TH: React.CSSProperties = { padding: "5px 8px", fontWeight: 600, color: "#8B7355",
  fontSize: 11, whiteSpace: "nowrap", textAlign: "left" };
const TD: React.CSSProperties = { padding: "3px 6px", verticalAlign: "middle" };

let _rid = 0;
function newRow(): ReceiptRow {
  return { _id: String(++_rid), productName: "", barcode: "", qty: "", unit: "шт", costRub: "" };
}

function downloadTemplate() {
  const rows = [
    "№,Название,Штрихкод,Количество,Ед.изм,Цена_руб",
    "1,Сок яблочный 1л,4607007729208,10,шт,120.50",
    "2,Вода питьевая 0.5л,,24,шт,35",
  ].join("\n");
  const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "шаблон_приёмка.csv";
  a.click();
}

// ЧЗ CSV: одна строка = один КИ, группируем по GTIN
async function parseChz(rows: string[][]): Promise<ReceiptRow[]> {
  const hdr = rows[0].map(h => h.toLowerCase().trim());
  const ni = hdr.findIndex(h => h.includes("назван"));
  const gi = hdr.findIndex(h => h.includes("gtin"));
  if (gi === -1) return [];

  const groups = new Map<string, { name: string; count: number }>();
  for (const row of rows.slice(1)) {
    const gtin = row[gi]?.trim();
    if (!gtin) continue;
    const name = ni >= 0 ? (row[ni]?.trim() || gtin) : gtin;
    const g = groups.get(gtin);
    if (g) g.count++; else groups.set(gtin, { name, count: 1 });
  }

  const pl = await loadPricelist();
  const byBc = new Map<string, string>();
  for (const it of pl) {
    const k = normalizeBarcode(it.barcode);
    if (k) byBc.set(k, it.name);
  }

  return [...groups.entries()].map(([gtin, { name, count }]) => {
    const k = normalizeBarcode(gtin);
    return newRowFrom(k ? (byBc.get(k) ?? name) : name, gtin, String(count));
  });
}

// Шаблон CSV: колонки по названию
function parseTemplate(rows: string[][]): ReceiptRow[] {
  const hdr = rows[0].map(h => h.toLowerCase().trim());
  const col = (keys: string[]) => hdr.findIndex(h => keys.some(k => h.includes(k)));
  const ni = col(["назван", "товар", "наим"]);
  const bi = col(["штрих", "barcode", "gtin", "код"]);
  const qi = col(["кол", "qty", "количе"]);
  const ui = col(["ед", "unit"]);
  const pi = col(["цен", "price", "стоим"]);

  return rows.slice(1)
    .filter(r => r.some(c => c.trim()))
    .map(r => newRowFrom(
      ni >= 0 ? (r[ni]?.trim() ?? "") : "",
      bi >= 0 ? (r[bi]?.trim() ?? "") : "",
      qi >= 0 ? (r[qi]?.trim() ?? "") : "",
      ui >= 0 ? (r[ui]?.trim() || "шт") : "шт",
      pi >= 0 ? (r[pi]?.trim() ?? "") : "",
    ));
}

const isFilled = (r: ReceiptRow) => Boolean(r.productName.trim() || r.barcode.trim());
// Пустое/ошибочное/нулевое кол-во — ошибка, а не «1»; пустая цена допустима (0)
const qtyBad  = (r: ReceiptRow) => isFilled(r) && parseQty(r.qty) === null;
const costBad = (r: ReceiptRow) => isFilled(r) && rubToKopecks(r.costRub, 0) === null;

function newRowFrom(name = "", barcode = "", qty = "", unit = "шт", costRub = ""): ReceiptRow {
  return { _id: String(++_rid), productName: name, barcode, qty, unit, costRub };
}

// Строка таблицы накладной
function ItemRow({ row, num, onUpdate, onRemove }: {
  row: ReceiptRow; num: number;
  onUpdate: (p: Partial<ReceiptRow>) => void;
  onRemove: () => void;
}) {
  const [sugg, setSugg] = useState<Array<{ productName: string; barcode: string | null }>>([]);

  async function search(q: string) {
    onUpdate({ productName: q, barcode: row.barcode });
    if (q.length < 2) { setSugg([]); return; }
    const pl = await loadPricelist();
    const ql = q.toLowerCase();
    setSugg(pl.filter(it =>
      String(it.name ?? "").toLowerCase().includes(ql) || String(it.barcode ?? "").includes(ql)
    ).slice(0, 8).map(it => ({ productName: it.name, barcode: it.barcode == null ? null : String(it.barcode) })));
  }

  const inp: React.CSSProperties = { width: "100%", border: "none", borderBottom: "1px solid #e0d8cc",
    background: "transparent", fontSize: 12, padding: "2px 0", outline: "none" };

  return (
    <tr style={{ borderBottom: "1px solid #f5f0e8" }}>
      <td style={{ ...TD, textAlign: "center", color: "#aaa", fontSize: 11, width: 28 }}>{num}</td>
      <td style={{ ...TD, position: "relative", minWidth: 180 }}>
        <input style={inp} value={row.productName}
          onChange={e => void search(e.target.value)}
          onBlur={() => setTimeout(() => setSugg([]), 200)}
          placeholder="Название…" />
        {sugg.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 80,
            background: "#fff", border: "1px solid #e0d8cc", borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,.12)", maxHeight: 200, overflowY: "auto" }}>
            {sugg.map((s, i) => (
              <div key={i} onMouseDown={() => { onUpdate({ productName: s.productName, barcode: s.barcode ?? "" }); setSugg([]); }}
                style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #f5f0e8" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#faf8f4")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}>
                <div style={{ fontWeight: 500 }}>{s.productName}</div>
                {s.barcode && <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>{s.barcode}</div>}
              </div>
            ))}
          </div>
        )}
      </td>
      <td style={{ ...TD, width: 130 }}>
        <input style={{ ...inp, fontFamily: "monospace", fontSize: 11 }} value={row.barcode}
          onChange={e => onUpdate({ barcode: e.target.value })} placeholder="—" />
      </td>
      <td style={{ ...TD, width: 65 }}>
        <input style={{ ...inp, textAlign: "right", ...(qtyBad(row) ? { borderBottom: "1px solid #C62828" } : {}) }} inputMode="decimal" value={row.qty}
          onChange={e => onUpdate({ qty: e.target.value })} placeholder="0" />
      </td>
      <td style={{ ...TD, width: 46 }}>
        <input style={{ ...inp, textAlign: "center" }} value={row.unit}
          onChange={e => onUpdate({ unit: e.target.value })} />
      </td>
      <td style={{ ...TD, width: 90 }}>
        <input style={{ ...inp, textAlign: "right", ...(costBad(row) ? { borderBottom: "1px solid #C62828" } : {}) }} inputMode="decimal" value={row.costRub}
          onChange={e => onUpdate({ costRub: e.target.value })} placeholder="0" />
      </td>
      <td style={{ ...TD, width: 24 }}>
        <button onClick={onRemove}
          style={{ background: "none", border: "none", color: "#C62828", cursor: "pointer", fontSize: 15, padding: 0 }}>×</button>
      </td>
    </tr>
  );
}

export function StockReceiptForm({ businessId, currentUser, region, suppliers, onSaved, onCancel }: Props) {
  const [supplier, setSupplier]     = useState("");
  const [receiptNum, setReceiptNum] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toLocaleDateString("ru-RU"));
  const [rows, setRows]             = useState<ReceiptRow[]>([newRow()]);
  // batchId — один на всю форму, группирует строки в одну накладную
  const [batchId]                   = useState(() => crypto.randomUUID());
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function upd(id: string, p: Partial<ReceiptRow>) {
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...p } : r));
  }

  async function handleFile(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      // Определяем разделитель по заголовку — КИ-коды ЧЗ могут содержать ;
      const firstLine = text.split(/\r?\n/)[0] ?? "";
      const sep = firstLine.includes(";") ? ";" : ",";
      const parsed = parseCsv(text, sep);
      if (parsed.length < 2) { alert("Файл пустой или не распознан"); return; }
      const hdr = parsed[0].map(h => h.toLowerCase());
      const items = hdr.some(h => h.includes("gtin") || h === "ки")
        ? await parseChz(parsed)
        : parseTemplate(parsed);
      if (!items.length) { alert("Не удалось распознать позиции"); return; }
      setRows(items);
      setShowImport(false);
    } catch (e) {
      alert("Ошибка чтения файла: " + String(e));
    } finally {
      setImporting(false);
    }
  }

  async function save() {
    const valid = rows.filter(isFilled);
    if (!valid.length || valid.some(r => qtyBad(r) || costBad(r))) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      for (const r of valid) {
        const qty = parseQty(r.qty)!;
        const costKopecks = rubToKopecks(r.costRub, 0)!;
        batch.set(doc(collection(db, `tenants/${businessId}/stock`)), {
          productName:  r.productName.trim() || r.barcode,
          barcode:      r.barcode.trim() || null,
          qty, unit: r.unit || "шт",
          supplierName: supplier.trim() || null,
          costKopecks,
          note: receiptNum ? `Накладная №${receiptNum}` : null,
          batchId,
          region: region ?? null,
          createdAt: now,
          createdBy: currentUser,
        });
      }
      await batch.commit();
      onSaved();
    } catch (e) {
      console.error("Receipt save:", e);
      alert("Ошибка: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  const validCount = rows.filter(isFilled).length;
  const badCount = rows.filter(r => qtyBad(r) || costBad(r)).length;

  return (
    <div className="go-form" style={{ marginBottom: 20 }}>
      <h3 style={{ margin: "0 0 14px", fontSize: 14, color: "#3A2E1E" }}>Приходная накладная</h3>

      {/* Шапка */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="go-field" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label>Поставщик</label>
          <input value={supplier} onChange={e => setSupplier(e.target.value)}
            placeholder="Название поставщика…" list="srf-sup-list" style={{ width: "100%", boxSizing: "border-box" }} />
          <datalist id="srf-sup-list">{suppliers.map(s => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="go-field" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
          <label>Накладная №</label>
          <input value={receiptNum} onChange={e => setReceiptNum(e.target.value)} placeholder="12345" />
        </div>
        <div className="go-field" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
          <label>Дата</label>
          <input value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
        </div>
        <button onClick={() => setShowImport(v => !v)}
          style={{ padding: "7px 14px", fontSize: 12, borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
            border: "1px solid rgba(200,154,52,.5)",
            background: showImport ? "rgba(200,154,52,.12)" : "transparent", color: "#8B6914" }}>
          📎 Загрузить файл
        </button>
      </div>

      {/* Панель импорта */}
      {showImport && (
        <div style={{ background: "#fffdf7", border: "1px dashed rgba(200,154,52,.45)", borderRadius: 10,
          padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#8B7355", marginBottom: 8 }}>
            Загрузка позиций из файла
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={downloadTemplate}
              style={{ fontSize: 12, padding: "6px 13px", borderRadius: 7, border: "1px solid #ddd",
                background: "#fff", cursor: "pointer", color: "#555" }}>
              ⬇ Скачать шаблон CSV
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={importing}
              style={{ fontSize: 12, padding: "6px 13px", borderRadius: 7, border: "none",
                background: "linear-gradient(135deg,#C89A34,#E8B84B)", color: "#fff",
                cursor: "pointer", fontWeight: 600 }}>
              {importing ? "Читаем…" : "📂 Выбрать файл"}
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
            <span style={{ fontSize: 11, color: "#aaa" }}>CSV шаблон или CSV Честного знака</span>
          </div>
        </div>
      )}

      {/* Таблица позиций */}
      <div style={{ overflowX: "auto", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#faf8f4", borderBottom: "1px solid #e0d8cc" }}>
              <th style={{ ...TH, textAlign: "center", width: 28 }}>№</th>
              <th style={TH}>Наименование</th>
              <th style={{ ...TH, width: 130 }}>Штрихкод / GTIN</th>
              <th style={{ ...TH, width: 65, textAlign: "right" }}>Кол-во</th>
              <th style={{ ...TH, width: 46 }}>Ед.</th>
              <th style={{ ...TH, width: 90, textAlign: "right" }}>Цена, ₽</th>
              <th style={{ width: 24 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <ItemRow key={r._id} row={r} num={i + 1}
                onUpdate={p => upd(r._id, p)}
                onRemove={() => setRows(p => p.length > 1 ? p.filter(x => x._id !== r._id) : p)} />
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={() => setRows(p => [...p, newRow()])}
        style={{ fontSize: 12, color: "#8B6914", background: "transparent",
          border: "1px dashed rgba(200,154,52,.4)", borderRadius: 6,
          padding: "4px 12px", cursor: "pointer", marginBottom: 16 }}>
        + Добавить строку
      </button>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="go-btn go-btn--gold" onClick={() => void save()}
          disabled={saving || validCount === 0 || badCount > 0}
          title={badCount > 0 ? "Исправьте количество/цену в подсвеченных строках" : undefined}>
          {saving ? "Сохранение…" : `Сохранить накладную (${validCount} поз.)`}
        </button>
        <button className="go-btn go-btn--outline" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
