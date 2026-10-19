import { useState, useEffect, useRef } from "react";
import { updateDoc, doc, collection, onSnapshot, query, orderBy, limit, getDoc, getDocs, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, statusLabel, statusColor, fmtRub } from "../useOrders";
import "../orders.css";
import { matchesRegion } from "../region";
import { invalidateOrdersArchive } from "../ordersStore";
import {
  parseTBankCsv, assignTxIds, legacyTxId, safeDocId, findMatchingOrder, fmtRuDate, txDateSortKey,
} from "../bankCsv";

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

// Поддерживает ISO (новые txDate, createdAt) и старый формат txDate "ДД.ММ.ГГГГ"
function fmtDate(iso: string) {
  return fmtRuDate(iso);
}

function usePayments(businessId: string) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, `tenants/${businessId}/payments`),
      // txDate в базе в двух форматах (старый ДД.ММ.ГГГГ, новый ISO) — лексикографический orderBy("txDate")
      // выбирал бы не те 100 записей. Окно — по времени импорта (createdAt, всегда ISO), порядок — ниже по txDate.
      orderBy("createdAt", "desc"),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payment, "id">) }));
      // В базе txDate бывает и "ГГГГ-ММ-ДД" (новые), и "ДД.ММ.ГГГГ" (старые) — сортируем по нормализованной дате
      list.sort((a, b) => {
        const ka = txDateSortKey(a.txDate), kb = txDateSortKey(b.txDate);
        return ka === kb ? 0 : ka < kb ? 1 : -1;
      });
      setPayments(list);
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
  const [search, setSearch] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ matched: number; new: number; total: number } | null>(null);

  async function handleCsvImport(file: File) {
    setImporting(true);
    setImportResult(null);
    let total = 0;
    let matchedCount = 0;
    let newCount = 0;
    const paidIds: string[] = [];
    try {
      const text = await file.text();
      const rows = assignTxIds(parseTBankCsv(text));
      total = rows.length;
      const paymentsCol = `tenants/${businessId}/payments`;

      // Заказы, которые уже не могут получить платёж: имеют привязанный платёж (из загруженных)
      // или сопоставлены в текущем импорте. Оплаченные отсекает findMatchingOrder.
      // Отменённые НЕ исключаются — привязка нужна для акта сверки.
      const taken = new Set<string>();
      for (const p of payments) if (p.orderId) taken.add(p.orderId);

      for (const row of rows) {
        const txId = row.txId;
        const paymentRef = doc(db, paymentsCol, safeDocId(txId));

        // Дедупликация по базе, а не по payments (limit 100):
        // 1) новый формат — детерминированный id документа;
        // 2) старый формат (txId = сырая_дата_сумма_ИНН, авто-id) — запрос where txId ==.
        //    Старый импорт писал все одинаковые строки с одним txId, поэтому k-я одинаковая
        //    строка считается импортированной, если старых документов >= k.
        let alreadyExists = (await getDoc(paymentRef)).exists();
        if (!alreadyExists) {
          const legacy = legacyTxId(row.dateRaw, row.credit, row.innRaw);
          const legacySnap = await getDocs(query(collection(db, paymentsCol), where("txId", "==", legacy)));
          alreadyExists = legacySnap.size >= row.occurrence;
        }
        if (alreadyExists) continue;

        // Сопоставляем строго по ИНН И сумме; самый старый неоплаченный и ещё не занятый заказ
        let exactMatch = findMatchingOrder(orders, row.payerInn, row.credit, taken);
        while (exactMatch) {
          // payments ограничены limit(100) — проверяем привязку в базе
          const linked = await getDocs(query(collection(db, paymentsCol), where("orderId", "==", exactMatch.id), limit(1)));
          if (linked.empty) break;
          taken.add(exactMatch.id);
          exactMatch = findMatchingOrder(orders, row.payerInn, row.credit, taken);
        }
        const status: "matched" | "unmatched" = exactMatch ? "matched" : "unmatched";

        // Платёж и отметка оплаты — одним батчем: при отказе в правах не остаётся
        // «сопоставленного» платежа при неоплаченном заказе. Повторный импорт пропустит записанное.
        const now = new Date().toISOString();
        const batch = writeBatch(db);
        batch.set(paymentRef, {
          txId,
          amount:    row.credit,
          payerName: row.payerName,
          payerInn:  row.payerInn,
          purpose:   row.purpose,
          txDate:    row.date,
          orderId:   exactMatch?.id ?? null,
          status,
          createdAt: now,
        });
        if (exactMatch) {
          batch.update(doc(db, `tenants/${businessId}/orders`, exactMatch.id), {
            paid: true, paidAt: now, updatedAt: now,
          });
        }
        await batch.commit();
        newCount++;
        if (exactMatch) {
          taken.add(exactMatch.id);
          paidIds.push(exactMatch.id);
          matchedCount++;
        }
      }

      setImportResult({ matched: matchedCount, new: newCount, total });
      setTab("payments");
    } catch (e) {
      if ((e as { code?: string }).code === "permission-denied") {
        alert(`Нет прав на запись платежей. Импорт остановлен: записано ${newCount} из ${total}.`);
        if (newCount > 0) setImportResult({ matched: matchedCount, new: newCount, total });
      } else {
        alert("Ошибка импорта выписки: " + String(e));
      }
    } finally {
      if (paidIds.length) invalidateOrdersArchive(businessId, paidIds);
      setImporting(false);
    }
  }

  // regionFilter: если задан — показываем только заказы и платежи этого региона
  const regionOrders = regionFilter ? orders.filter((o) => matchesRegion(o, regionFilter)) : orders;
  const active = regionOrders.filter((o) => o.status !== "cancelled");
  const now    = new Date();

  const monthRevenue = active
    .filter((o) => {
      if (!o.paid) return false;
      // Выручка по деньгам: дата оплаты; для старых заказов без paidAt — дата создания
      const d = new Date(o.paidAt || o.createdAt);
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

  const searchLow = search.trim().toLowerCase();
  const filteredOrders = active.filter((o) => {
    if (filter === "paid" && !o.paid) return false;
    if (filter === "unpaid" && o.paid) return false;
    if (!searchLow) return true;
    const amtStr = (o.totalKopecks / 100).toFixed(0);
    return (
      o.customerName?.toLowerCase().startsWith(searchLow) ||
      o.customerName?.toLowerCase().includes(searchLow) ||
      amtStr.includes(searchLow)
    );
  });

  async function markPaid(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), {
      paid: true, paidAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    invalidateOrdersArchive(businessId, [orderId]);
  }

  async function linkPayment(paymentId: string, orderId: string) {
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    batch.update(doc(db, `tenants/${businessId}/payments`, paymentId), { orderId, status: "matched" });
    batch.update(doc(db, `tenants/${businessId}/orders`, orderId), { paid: true, paidAt: now, updatedAt: now });
    await batch.commit();
    invalidateOrdersArchive(businessId, [orderId]);
  }

  async function markUnpaid(orderId: string) {
    await updateDoc(doc(db, `tenants/${businessId}/orders`, orderId), {
      paid: false, updatedAt: new Date().toISOString(),
    });
    invalidateOrdersArchive(businessId, [orderId]);
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

          <input
            type="search"
            placeholder="Поиск по клиенту или сумме…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              margin: "8px 0 4px", padding: "8px 14px", borderRadius: 8,
              border: "1px solid #e0d8cc", background: "#faf8f4",
              fontSize: 13, color: "#3A2E1E", outline: "none",
            }}
          />

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
                            onChange={(e) => {
                              const orderId = e.target.value;
                              if (!active.some(o => o.id === orderId)) return;
                              const select = e.target;
                              void linkPayment(p.id, orderId).catch((err: unknown) => {
                                console.error("Manual payment match failed:", err);
                                alert((err as { code?: string }).code === "permission-denied"
                                  ? "Нет прав на запись платежей"
                                  : "Ошибка привязки платежа: " + String(err));
                                select.value = "";
                              });
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
