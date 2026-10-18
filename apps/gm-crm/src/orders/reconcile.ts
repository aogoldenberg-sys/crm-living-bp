// ── Акт сверки: чистые хелперы (покрыты тестами reconcile.test.ts) ─────────
import { fmtRuDate, parseBankDate, normalizeInn } from "./bankCsv";

/**
 * Нормализованное наименование контрагента для сравнения:
 * без кавычек любого вида (" « » „ “ ” ' ` и испорченных ""), регистр, ё→е, лишние пробелы.
 * `ООО "Ромашка"`, `ООО ""Ромашка""`, `ооо «Ромашка» ` → `ооо ромашка`.
 */
export function normalizePartyName(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`«»„“”‘’]/g, " ")
    .replace(/[\s  ]+/g, " ")
    .trim();
}

export interface PaymentDocLike {
  txDate?: string;
  createdAt?: string;
  amount?: number;      // копейки
  purpose?: string;
  payerName?: string;
  payerInn?: string;
  orderId?: string | null;
}

/** Платёж относится к клиенту: по ИНН (нормализованно) или по наименованию (нормализованно). */
export function paymentBelongsTo(p: PaymentDocLike, customerName: string, customerInn?: string | null): boolean {
  const inn = normalizeInn(customerInn);
  if (inn && normalizeInn(p.payerInn) === inn) return true;
  const name = normalizePartyName(customerName);
  return !!name && normalizePartyName(p.payerName) === name;
}

/** Дата платежа для акта ("ДД.ММ.ГГГГ"): txDate в ISO или старом ДД.ММ.ГГГГ, иначе createdAt. */
export function paymentDisplayDate(p: PaymentDocLike): string {
  const tx = (p.txDate ?? "").trim();
  if (tx && parseBankDate(tx)) return fmtRuDate(tx);
  return fmtRuDate(p.createdAt ?? "") || tx;
}

/** Ключ сортировки строки акта по дате "ДД.ММ.ГГГГ" (или ISO). Нераспознанные — в конец. */
export function reconDateKey(date: string): string {
  return parseBankDate(date) || "9999-99-99";
}

export function sortReconRows<T extends { date: string }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i, k: reconDateKey(r.date) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.r);
}
