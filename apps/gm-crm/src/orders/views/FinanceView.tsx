import { useState, useEffect, useRef } from "react";
import { updateDoc, doc, collection, onSnapshot, query, orderBy, limit, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, statusLabel, statusColor, fmtRub } from "../useOrders";
import "../orders.css";

// ── Парсер CSV-выписки T-Bank ─────────────────────────────────────────────
interface BankRow {
  date: string;
  credit: number;     // копейки, входящий платёж (Зачислено)
  payerName: string;
  payerInn: string;
  purpose: string;
}

function parseTBankCsv(text: string): BankRow[] {
  // T-Bank использует ; как разделитель, первые строки могут быть шапкой отчёта
  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  // Ищем строку-заголовок (содержит "зачислено" или "приход")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/зачислено|приход|credit/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];

  const sep = lines[headerIdx].includes(";") ? ";" : ",";
  const headers = lines[headerIdx].split(sep).map((h) => h.trim().replace(/"/g, "").toLowerCase());

  const col = (names: string[]) => {
    for (const n of names) {
      const idx = headers.findIndex((h) => h.includes(n));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const iDate    = col(["дата операции", "дата", "date"]);
  const iCredit  = col(["зачислено", "приход", "credit", "income"]);
  const iPayer   = col(["наименование контрагента", "контрагент", "плательщик", "payer", "counterparty"]);
  const iInn     = col(["инн/кпп", "инн контрагента", "инн плательщика", "inn", "инн"]);
  const iPurpose = col(["назначение платежа", "назначение", "описание", "purpose", "description"]);

  const rows: BankRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 3) continue;

    // Только входящие (зачислено > 0)
    const creditStr = iCredit >= 0 ? cells[iCredit] : "";
    const credit = Math.round(parseFloat(creditStr.replace(/\s/g, "").replace(",", ".")) * 100);
    if (!credit || credit <= 0) continue;

    // ИНН: берём часть до "/" (формат "ИНН/КПП")
    const innRaw = iInn >= 0 ? cells[iInn] : "";
    const payerInn = innRaw.split("/")[0].trim();

    rows.push({
      date:      iDate    >= 0 ? cells[iDate]    : "",
      credit,
      payerName: iPayer   >= 0 ? cells[iPayer]   : "",
      payerInn,
      purpose:   iPurpose >= 0 ? cells[iPurpose] : "",
    });
  }
  return rows;
}

interface Props { businessId: string; regionFilter?: string; }

type MainTab  = "orders" | "payments";
type PayFilter = "all" | "paid" | "unpaid";

interface Payment {
  id: string;
  txId: string;
  amount: number;       // kopecks
  payerName: string;
  payerInn: string;
  purpose: string;
  txDate: string;
  orderId: string | null;
  status: "matched" | "unmatched";
  createdAt: string;
}

function isOverdue(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 7 * 24 * 60 * 60 * 1000;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("ru-RU"); } catch { return iso; }
}

function usePayments(businessId: string) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, `tenants/${businessId}/payments`),
      orderBy("txDate", "desc"),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payment, "id">) })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [businessId]);

  return { payments, loading };
}

export function FinanceView({ businessId, regionFilter }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading: ordersLoading } = useOrders(businessId, "finance", uid);
  const { payments, loading: paymentsLoading } = usePayments(businessId);

  const [tab, setTab]       = useState<MainTab>("orders");
  const [filter, setFilter] = useState<PayFilter>("all");

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ matched: number; new: number; total: number } | null>(null);

  async function handleCsvImport(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseTBankCsv(text);

      // Индекс неоплаченных заказов по ИНН
      const ordersByInn = new Map<string, typeof orders[0][]>();
      for (const o of orders) {
        if (!o.customerInn || o.paid) continue;
        const inn = o.customerInn.trim();
        if (!ordersByInn.has(inn)) ordersByInn.set(inn, []);
        ordersByInn.get(inn)!.push(o);
      }

      let matchedCount = 0;
      let newCount = 0;

      for (const row of rows) {
        const txId = `${row.date}_${row.credit}_${row.payerInn}`;
        const alreadyExists = payments.some((p) => p.txId === txId);

        const candidates = ordersByInn.get(row.payerInn) ?? [];
        // Сопоставляем по ИНН И сумме — без точного совпадения не трогаем заказ
        const exactMatch = candidates.find((o) => o.totalKopecks === row.credit);
        const status: "matched" | "unmatched" = exactMatch ? "matched" : "unmatched";

        if (!alreadyExists) {
          await setDoc(doc(collection(db, `tenants/${businessId}/payments`)), {
            txId,
            amount:    row.credit,
            payerName: row.payerName,
            payerInn:  row.payerInn,
            purpose:   row.purpose,
            txDate:    row.date,
            orderId:   exactMatch?.id ?? null,
            status,
            createdAt: new Date().toISOString(),
          });
          newCount++;
        }

        if (exactMatch && !alreadyExists) {
          matchedCount++;
          await updateDoc(doc(db, `tenants/${businessId}/orders`, exactMatch.id), {
            paid: true, paidAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
        }
      }

      setImportResult({ matched: matchedCount, new: newCount, total: rows.length });
      setTab("payments");
    } catch (e) {
      alert("Ошибка разбора файла: " + String(e));
    }
    setImporting(false);
  }

  // regionFilter: если задан — показываем только заказы и платежи этого региона
  const regionOrders = regionFilter ? orders.filter((o) => o.region === regionFilter) : orders;
  const active = regionOrders.filter((o) => o.status !== "cancelled");
  const now    = new Date();

  const monthRevenue = active
    .filter((o) => {
      if (!o.paid) return false;
      const d = new Date(o.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, o) => s + o.totalKopecks, 0);

  const totalDebt  = active.filter((o) => !o.paid).reduce((s, o) => s + o.totalKopecks, 0);
  const todayDue   = active
    .filter((o) => !o.paid && new Date(o.createdAt).toDateString() === now.toDateString())
    .reduce((s, o) => s + o.totalKopecks, 0);

  const spbOrderIds = regionFilter ? new Set(regionOrders.map((o) => o.id)) : null;
  const visiblePayments = spbOrderIds
    ? payments.filter((p) => !p.orderId || spbOrderIds.has(p.orderId))
    : payments;
  const unmatched  = visiblePayments.filter((p) => p.status === "unmatched").length;

  const filteredOrders = active.filter((o) =>
    filter === "paid" ? o.paid : filter === "unpaid" ? !o.paid : true
  );

  async function markPaid(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), {
      paid: true, paidAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  async function markUnpaid(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), {
      paid: false, updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Финансы · Густорико</h1>
        <div style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
          <div style={{ fontSize:12,color:"#8B7355",display:"flex",alignItems:"center",gap:8 }}>
            <span style={{ width:8,height:8,borderRadius:"50%",background:"#16A34A",display:"inline-block" }}/>
            р/с 40702810910002035693 · АО «ТБанк»
            {unmatched > 0 && (
              <span style={{ background:"#C62828",color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:700 }}>
                {unmatched} нераспозн.
              </span>
            )}
          </div>
          {/* Импорт выписки */}
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display:"none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCsvImport(f); e.target.value = ""; }} />
          <button className="go-btn go-btn--outline" onClick={() => fileRef.current?.click()}
            disabled={importing}
            style={{ fontSize:12,padding:"4px 12px" }}>
            {importing ? "Загружаем…" : "📥 Загрузить выписку T-Bank"}
          </button>
        </div>
      </div>

      {/* Результат импорта */}
      {importResult && (
        <div style={{ margin:"0 0 12px",padding:"10px 16px",borderRadius:8,fontSize:13,
          background:"rgba(46,125,50,.07)",border:"1px solid rgba(46,125,50,.25)",
          display:"flex",gap:20,alignItems:"center" }}>
          <span>✓ Разобрано <b>{importResult.total}</b> платежей</span>
          <span style={{ color:"#2E7D32" }}>Совпало с заказами: <b>{importResult.matched}</b></span>
          <span style={{ color:"#8B7355" }}>Новых записей: <b>{importResult.new}</b></span>
          <button onClick={() => setImportResult(null)}
            style={{ marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#8B7355",fontSize:16 }}>✕</button>
        </div>
      )}

      {/* KPI */}
      <div className="go-stats">
        <div className="go-stat-card">
          <div className="label">К получению сегодня</div>
          <div className="value" style={{ fontSize:18 }}>{fmtRub(todayDue)}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Дебиторка</div>
          <div className="value" style={{ fontSize:18, color: totalDebt > 0 ? "#C62828" : "#2E7D32" }}>
            {fmtRub(totalDebt)}
          </div>
        </div>
        <div className="go-stat-card">
          <div className="label">Выручка месяца</div>
          <div className="value" style={{ fontSize:18 }}>{fmtRub(monthRevenue)}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Платежей сегодня</div>
          <div className="value" style={{ fontSize:18, color:"#16A34A" }}>
            {visiblePayments.filter((p) => p.status === "matched" && fmtDate(p.txDate) === fmtDate(now.toISOString())).length}
          </div>
        </div>
      </div>

      {/* Главные вкладки */}
      <div className="go-tabs" style={{ marginBottom:0 }}>
        <button className={"go-tab" + (tab === "orders" ? " active" : "")} onClick={() => setTab("orders")}>
          Заказы / дебиторка
        </button>
        <button className={"go-tab" + (tab === "payments" ? " active" : "")} onClick={() => setTab("payments")}>
          Платежи T-Bank
          {unmatched > 0 && (
            <span style={{ marginLeft:6,background:"#C62828",color:"#fff",borderRadius:8,padding:"1px 6px",fontSize:10 }}>
              {unmatched}
            </span>
          )}
        </button>
      </div>

      {/* ── Вкладка: Заказы ── */}
      {tab === "orders" && (
        <>
          <div className="go-tabs" style={{ marginTop:4 }}>
            {(["all","unpaid","paid"] as PayFilter[]).map((t) => (
              <button key={t} className={"go-tab" + (filter === t ? " active" : "")} onClick={() => setFilter(t)}>
                {t === "all" ? "Все" : t === "unpaid" ? "Не оплачено" : "Оплачено"}
              </button>
            ))}
          </div>

          {ordersLoading ? <div className="go-empty">Загрузка…</div>
          : filteredOrders.length === 0 ? <div className="go-empty">Нет заказов</div>
          : (
            <div className="go-table-wrap">
              <table className="go-table">
                <thead>
                  <tr>
                    <th>Дата</th><th>Клиент</th><th>ИНН</th><th>Сумма</th>
                    <th>Статус</th><th>Оплата</th><th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const overdue = !o.paid && isOverdue(o.createdAt);
                    return (
                      <tr key={o.id}>
                        <td>{fmtDate(o.createdAt)}</td>
                        <td style={{ color: overdue ? "#C62828" : undefined, fontWeight: overdue ? 600 : undefined }}>
                          {o.customerName}
                          {overdue && <span style={{ fontSize:10,marginLeft:6,color:"#C62828" }}>просрочено</span>}
                        </td>
                        <td style={{ fontSize:11,color:"#8B7355" }}>{o.customerInn ?? "—"}</td>
                        <td>{fmtRub(o.totalKopecks)}</td>
                        <td>
                          <span className="go-badge" style={{ background: statusColor(o.status)+"22", color: statusColor(o.status) }}>
                            {statusLabel(o.status)}
                          </span>
                        </td>
                        <td>
                          <span className="go-badge" style={{ background: o.paid ? "#D4EDDA" : "#F8D7DA", color: o.paid ? "#155724" : "#721C24" }}>
                            {o.paid ? "✓ Оплачено" : "Долг"}
                          </span>
                        </td>
                        <td>
                          {!o.paid
                            ? <button className="go-btn go-btn--green" onClick={() => void markPaid(o.id)}>Отметить</button>
                            : <button onClick={() => void markUnpaid(o.id)}
                                style={{ fontSize:11,padding:"3px 10px",borderRadius:6,cursor:"pointer",
                                  border:"1px solid #C6282833",background:"transparent",color:"#C62828" }}>
                                ↩ Долг
                              </button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Вкладка: Платежи T-Bank ── */}
      {tab === "payments" && (
        <>
          {/* Инструкция если нет токена / пусто */}
          {!paymentsLoading && payments.length === 0 && (
            <div style={{ margin:"24px 0",padding:"20px 24px",background:"rgba(200,154,52,.07)",
              border:"1px solid rgba(200,154,52,.25)",borderRadius:12 }}>
              <div style={{ fontWeight:700,marginBottom:10,fontSize:15 }}>📥 Как загрузить выписку T-Bank</div>
              <ol style={{ fontSize:13,lineHeight:2,color:"#4a4a4a",paddingLeft:20,margin:0 }}>
                <li>Открыть <b>tbank.ru → Бизнес → Операции</b></li>
                <li>Выбрать нужный период → кнопка <b>«Скачать выписку»</b></li>
                <li>Формат: <b>CSV</b> (не Excel и не PDF)</li>
                <li>Нажать <b>«📥 Загрузить выписку T-Bank»</b> вверху этой страницы → выбрать скачанный файл</li>
              </ol>
              <div style={{ fontSize:12,color:"#8B7355",marginTop:10 }}>
                Система автоматически сопоставит платежи с заказами по ИНН и отметит оплаченные.
              </div>
            </div>
          )}

          {paymentsLoading && <div className="go-empty">Загрузка платежей…</div>}

          {visiblePayments.length > 0 && (
            <div className="go-table-wrap" style={{ marginTop:16 }}>
              <table className="go-table">
                <thead>
                  <tr>
                    <th>Дата</th><th>Плательщик</th><th>ИНН</th>
                    <th>Сумма</th><th>Статус</th><th>Назначение</th><th>Привязать к заказу</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ whiteSpace:"nowrap" }}>{fmtDate(p.txDate)}</td>
                      <td style={{ fontWeight: p.status === "unmatched" ? 600 : undefined,
                        color: p.status === "unmatched" ? "#C62828" : undefined }}>
                        {p.payerName || "—"}
                      </td>
                      <td style={{ fontSize:11,color:"#8B7355" }}>{p.payerInn || "—"}</td>
                      <td style={{ fontWeight:600,color:"#16A34A" }}>{fmtRub(p.amount)}</td>
                      <td>
                        {p.status === "matched"
                          ? <span className="go-badge" style={{ background:"#D4EDDA",color:"#155724" }}>✓ Сопоставлен</span>
                          : <span className="go-badge" style={{ background:"#F8D7DA",color:"#721C24" }}>❓ Нераспознан</span>}
                      </td>
                      <td style={{ fontSize:11,color:"#666",maxWidth:200,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                        {p.purpose || "—"}
                      </td>
                      <td style={{ minWidth:200 }}>
                        {p.status === "unmatched" ? (
                          <select
                            defaultValue=""
                            onChange={async (e) => {
                              const orderId = e.target.value;
                              if (!orderId) return;
                              const order = active.find(o => o.id === orderId);
                              if (!order) return;
                              await Promise.all([
                                updateDoc(doc(db, `tenants/${businessId}/payments`, p.id), {
                                  orderId, status: "matched",
                                }),
                                updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), {
                                  paid: true, paidAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                                }),
                              ]);
                            }}
                            style={{ fontSize:11,padding:"3px 6px",borderRadius:6,
                              border:"1px solid #e0d8cc",background:"#faf8f4",
                              color:"#3A2E1E",maxWidth:190 }}>
                            <option value="">— выбрать клиента —</option>
                            {active.filter(o => !o.paid).map(o => (
                              <option key={o.id} value={o.id}>
                                {o.customerName} · {fmtRub(o.totalKopecks)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontSize:11,color:"#aaa" }}>
                            {active.find(o => o.id === p.orderId)?.customerName ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
