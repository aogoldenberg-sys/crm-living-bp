// Деньги — целые копейки. Сумма заказа уже включает НДС 22% (решение владельца):
// в документах НДС выделяется изнутри, а не начисляется сверху.

export const VAT_RATE = 22;

export interface PricedItem {
  quantity?: number | null;
  qty?: number | null;
  unitPrice?: number | null;      // копейки (в старых заказах НаПолке бывает в рублях)
  totalKopecks?: number | null;
}

/** В заказах НаПолке встречается qty вместо quantity; строку/NaN считаем числом/нулём. */
export function itemQty(it: { quantity?: number | null; qty?: number | null }): number {
  return Number(it.quantity ?? it.qty ?? 0) || 0;
}

/** Итог позиции, коп.: totalKopecks надёжнее unitPrice. */
export function itemTotalKopecks(it: PricedItem): number {
  if (it.totalKopecks && it.totalKopecks > 0) return Math.round(it.totalKopecks);
  return Math.round(itemQty(it) * (it.unitPrice ?? 0));
}

/** Цена за единицу с НДС, коп.: от totalKopecks / кол-во, иначе unitPrice. */
export function itemUnitKopecks(it: PricedItem): number {
  const q = itemQty(it);
  if (it.totalKopecks && it.totalKopecks > 0 && q > 0) return Math.round(it.totalKopecks / q);
  return Math.round(it.unitPrice ?? 0);
}

/** НДС внутри суммы, коп.: round(total × 22 / 122). */
export function vatInside(totalKopecks: number): number {
  return Math.round((totalKopecks * VAT_RATE) / (100 + VAT_RATE));
}

export interface VatLine { total: number; vat: number; net: number }

/**
 * Разбивка НДС по строкам. НДС итога считается от итога, остаток округления —
 * на последнюю строку, чтобы сумма строк совпадала с итогом до копейки.
 */
export function splitVat(lineTotals: number[]): { lines: VatLine[]; total: number; vat: number; net: number } {
  const total = lineTotals.reduce((s, t) => s + t, 0);
  const vat = vatInside(total);
  let rest = vat;
  const lines = lineTotals.map((t, i) => {
    const v = i === lineTotals.length - 1 ? rest : vatInside(t);
    rest -= v;
    return { total: t, vat: v, net: t - v };
  });
  return { lines, total, vat, net: total - vat };
}

/** Копейки → "1 234,50" (всегда 2 знака). */
export function fmtKop(kopecks: number): string {
  return (kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Позиция заказа → строка УПД (цена в рублях с НДС, итог строки — точно из заказа). */
export function orderItemToUpd(it: PricedItem & { productName: string; unit?: string }) {
  return {
    name: it.productName,
    qty: itemQty(it),
    unit: it.unit || "шт",
    price: itemUnitKopecks(it) / 100,
    totalKopecks: itemTotalKopecks(it),
    selected: true,
  };
}
