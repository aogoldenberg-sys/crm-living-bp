// Единственная точка отгрузки/возврата заказа: статус, списание со склада, долг — одной транзакцией.
import { collection, deleteField, doc, getDoc, getDocs, query, runTransaction, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { loadPricelist, type Order } from "./useOrders";
import { buildPlIndex, computePlMatches } from "./plIndex";
import { normalizeRegion } from "./region";
import {
  STOCK, avgCost, buildLine, buildStockIndex, mergeLine, planShipment,
  type SavedLine, type StockRow,
} from "./stockOps";

type OrderDoc = { status?: string; stockWriteoffIds?: string[]; deliveryDate?: string | null };

/**
 * Отгрузка. Повтор (двойной клик, второе окно) ничего не делает: статус проверяется внутри транзакции.
 * Списания пишутся с id `${orderId}_${idx}` и содержат накопленное отгруженное кол-во,
 * поэтому повторная отгрузка долга (Долги → «В сборку» → «Отгрузить») перезаписывает, а не дублирует.
 * Возвращает false, если заказ уже был отгружен.
 */
export async function shipOrder(businessId: string, order: Order, lines: SavedLine[], uid: string): Promise<boolean> {
  const t = `tenants/${businessId}`;
  const orderRef = doc(db, `${t}/orders/${order.id}`);
  const debtRef = doc(db, `${t}/debts/${order.id}`);
  const shipped = await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    const cur = snap.data() as OrderDoc | undefined;
    if (!cur || cur.status === "delivered") return false;
    const prevDebt = await tx.get(debtRef);
    const now = new Date().toISOString();
    const plan = planShipment(order, lines, uid, now);
    const ids = plan.stock.map(s => s.id);
    for (const id of cur.stockWriteoffIds ?? []) if (!ids.includes(id)) tx.delete(doc(db, `${t}/stock/${id}`));
    for (const s of plan.stock) tx.set(doc(db, `${t}/stock/${s.id}`), s.data);
    if (plan.debt) {
      const createdAt = (prevDebt.data() as { createdAt?: string } | undefined)?.createdAt ?? now;
      tx.set(debtRef, { ...plan.debt, createdAt });
    } else if (prevDebt.exists()) {
      tx.delete(debtRef);
    }
    // Финальные строки сохраняем: по ним считается себестоимость (qtyPacked * unitCostKopecks)
    const clean = lines.map(l => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)));
    tx.set(doc(db, `${t}/assembly/${order.id}`), { lines: clean, updatedAt: now }, { merge: true });
    tx.update(orderRef, { status: "delivered", stockWrittenOff: true, stockWriteoffIds: ids, deliveredAt: now, updatedAt: now });
    return true;
  });
  if (shipped) await setPurchaseLinesShipped(businessId, order.id, true);
  return shipped;
}

/** «↩ Не отгружен»: возвращает остаток (удаляет списания этого заказа) и снимает долг отгрузки. */
export async function unshipOrder(businessId: string, orderId: string): Promise<boolean> {
  const t = `tenants/${businessId}`;
  const orderRef = doc(db, `${t}/orders/${orderId}`);
  const done = await runTransaction(db, async (tx) => {
    const cur = (await tx.get(orderRef)).data() as OrderDoc | undefined;
    if (!cur || cur.status !== "delivered") return false;
    for (const id of cur.stockWriteoffIds ?? []) tx.delete(doc(db, `${t}/stock/${id}`));
    tx.delete(doc(db, `${t}/debts/${orderId}`));
    tx.update(orderRef, { status: "sourcing", stockWrittenOff: false, stockWriteoffIds: [],
      deliveredAt: deleteField(), updatedAt: new Date().toISOString() });
    return true;
  });
  if (done) await setPurchaseLinesShipped(businessId, orderId, false);
  return done;
}

// РЕШЕНИЕ: purchase_lines при отгрузке не удаляем (нужны для себестоимости) — переводим pending/ordered
// в "shipped" и запоминаем прежний статус, чтобы «↩ Не отгружен» вернул их в закупку. Скажи если не так.
async function setPurchaseLinesShipped(businessId: string, orderId: string, shipped: boolean) {
  const col = collection(db, `tenants/${businessId}/purchase_lines`);
  const snap = await getDocs(query(col, where("orderId", "==", orderId)));
  const batch = writeBatch(db);
  for (const d of snap.docs) {
    const pl = d.data() as { status?: string; statusBeforeShip?: string };
    if (shipped && (pl.status === "pending" || pl.status === "ordered")) {
      batch.update(d.ref, { status: "shipped", statusBeforeShip: pl.status });
    } else if (!shipped && pl.status === "shipped") {
      batch.update(d.ref, { status: pl.statusBeforeShip ?? "pending", statusBeforeShip: deleteField() });
    }
  }
  await batch.commit();
}

/** Ставит дату доставки, только если её ещё нет — ручную дату менеджера не трогаем. */
export async function ensureDeliveryDate(businessId: string, orderId: string, date: string): Promise<void> {
  const ref = doc(db, `tenants/${businessId}/orders/${orderId}`);
  await runTransaction(db, async (tx) => {
    const cur = (await tx.get(ref)).data() as OrderDoc | undefined;
    if (!cur || cur.deliveryDate) return;
    tx.update(ref, { deliveryDate: date, updatedAt: new Date().toISOString() });
  });
}

/**
 * Строки для отгрузки из раздела «Заказы»: сохранённые строки сборки, а для позиций без них —
 * построенные так же, как в карточке сборки (склад региона, затем прайс). qtys — факт из «Заказов».
 */
export async function linesForShipment(businessId: string, order: Order, qtys: number[]): Promise<SavedLine[]> {
  const t = `tenants/${businessId}`;
  const saved = ((await getDoc(doc(db, `${t}/assembly/${order.id}`))).data()?.lines ?? []) as SavedLine[];
  const prevOf = (idx: number) => saved.find(l => l.idx === idx);
  const region = normalizeRegion(order.region, order.address);
  const [pl, stockSnap] = await Promise.all([loadPricelist(), getDocs(collection(db, `${t}/stock`))]);
  const plIndex = buildPlIndex(pl);
  const stock = buildStockIndex(stockSnap.docs.map(d => d.data() as StockRow));
  return order.items.map((item, idx) => {
    const l = mergeLine(prevOf(idx), item, buildLine(item, idx, computePlMatches(plIndex, item), stock, region));
    const cost = l.supplierName === STOCK && !l.unitCostKopecks ? avgCost(stock, region, l) : l.unitCostKopecks;
    return withPacked({ ...l, unitCostKopecks: cost }, qtys[idx]);
  });
}

function withPacked({ matches: _m, ...l }: SavedLine & { matches: unknown }, qty: number | undefined): SavedLine {
  return { ...l, qtyPacked: qty ?? 0 };
}
