// ── Разбор CSV-выписки Т-Банк ─────────────────────────────────────────────
// Чистые функции без зависимостей от Firebase/React — покрыты тестами (bankCsv.test.ts).

export interface BankRow {
  date: string;       // ISO "ГГГГ-ММ-ДД"; если дату распознать не удалось — исходная строка
  credit: number;     // копейки, входящий платёж (Зачислено)
  payerName: string;
  payerInn: string;   // нормализованный ИНН (только цифры)
  purpose: string;
  docNumber: string;  // номер платёжного документа, "" если колонки нет
  dateRaw: string;    // дата как в файле (для совместимости со старыми txId)
  innRaw: string;     // ИНН как его брал старый парсер: часть до "/" (для совместимости со старыми txId)
}

/**
 * RFC 4180: поля в кавычках могут содержать разделитель, переносы строк и "" (экранированная кавычка).
 * Возвращает массив записей (массив ячеек). Пустые строки пропускаются.
 */
export function parseCsv(text: string, sep: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  const endRow = () => {
    row.push(cell);
    cell = "";
    if (!(row.length === 1 && row[0].trim() === "")) records.push(row);
    row = [];
  };

  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') {
      // Кавычка открывает поле только в начале ячейки (допускаем пробелы перед ней);
      // иначе — литерал (нестрогие файлы).
      if (cell.trim() === "") { cell = ""; inQuotes = true; } else { cell += ch; }
      i++; continue;
    }
    if (ch === sep) { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r") { endRow(); i += src[i + 1] === "\n" ? 2 : 1; continue; }
    if (ch === "\n") { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length > 0) endRow();
  return records;
}

/** Сумма "1 234,56" / "1 234.56" / "1.234,56" / NBSP → копейки (целое), без float-ошибок. NaN если не число. */
export function parseAmountKopecks(raw: string): number {
  let s = (raw ?? "").replace(/[\s   '"]/g, "").replace(/(руб\.?|₽|rub)$/i, "");
  if (!s) return NaN;
  let sign = 1;
  if (s[0] === "-" || s[0] === "−") { sign = -1; s = s.slice(1); }
  else if (s[0] === "+") s = s.slice(1);

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart = s;
  let fracPart = "";
  if (lastComma !== -1 && lastDot !== -1) {
    const dec = Math.max(lastComma, lastDot);
    intPart = s.slice(0, dec).replace(/[.,]/g, "");
    fracPart = s.slice(dec + 1);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sepCh = lastComma !== -1 ? "," : ".";
    const parts = s.split(sepCh);
    if (parts.length > 2) { intPart = parts.join(""); }            // разделители тысяч
    else { intPart = parts[0]; fracPart = parts[1]; }
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) return NaN;

  const frac = (fracPart + "00").slice(0, 2);
  let kop = Number(intPart) * 100 + Number(frac);
  if (fracPart.length > 2 && Number(fracPart[2]) >= 5) kop += 1;   // округление half-up по 3-му знаку
  return sign * kop;
}

/**
 * ИНН: "7701234567/770101001", "ИНН 7701234567 КПП ...", "'0274...", "=\"0274...\"" → только цифры ИНН.
 * Ведущий ноль, потерянный Excel'ем (9 или 11 цифр), восстанавливается до 10/12.
 */
export function normalizeInn(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).split("/")[0];
  s = s.split(/кпп/i)[0];
  let digits = s.replace(/\D/g, "");
  if (digits.length > 12) digits = (s.match(/\d+/g) ?? [""])[0];  // "7701234567 770101001"
  if (digits.length === 9 || digits.length === 11) return "0" + digits;
  return digits;
}

/** "ДД.ММ.ГГГГ[ ЧЧ:ММ[:СС]]", "ДД.ММ.ГГ", "ГГГГ-ММ-ДД[...]" → "ГГГГ-ММ-ДД"; "" если не распознано. */
export function parseBankDate(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\D|$)/.exec(s);
  if (mt) {
    d = +mt[1]; m = +mt[2]; y = +mt[3];
    if (mt[3].length === 2) y += 2000;
  } else if ((mt = /^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/.exec(s))) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else {
    return "";
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Дата для показа ("ДД.ММ.ГГГГ"): ISO-дата, ISO-время (createdAt) и старый формат ДД.ММ.ГГГГ. */
export function fmtRuDate(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  if (!s) return "";
  // Чистая дата (новые txDate) или старый ДД.ММ.ГГГГ — без new Date(), чтобы не было сдвига по часовому поясу
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{2,4}(?:\s|$)/.test(s)) {
    const iso = parseBankDate(s);
    if (iso) { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; }
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s;
  return dt.toLocaleDateString("ru-RU");
}

/** Ключ сортировки для txDate в любом формате ("ГГГГ-ММ-ДД" или "" ). */
export function txDateSortKey(value: string | null | undefined): string {
  return parseBankDate(value);
}

const HEADER_RE = /зачислено|приход|credit/i;

export function parseTBankCsv(text: string): BankRow[] {
  // Т-Банк использует ";" как разделитель, первые строки могут быть шапкой отчёта
  let records: string[][] = [];
  let headerIdx = -1;
  for (const sep of [";", ",", "\t"]) {
    const recs = parseCsv(text, sep);
    const idx = recs.slice(0, 20).findIndex((r) => r.length >= 3 && HEADER_RE.test(r.join(" ")));
    if (idx !== -1) { records = recs; headerIdx = idx; break; }
  }
  if (headerIdx === -1) return [];

  const headers = records[headerIdx].map((h) => h.trim().toLowerCase());
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
  const iDocNum  = col(["номер документа", "№ документа", "номер док", "№ док", "document number", "doc number"]);

  const get = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

  const rows: BankRow[] = [];
  for (let r = headerIdx + 1; r < records.length; r++) {
    const cells = records[r];
    if (cells.length < 3) continue;

    // Только входящие (зачислено > 0)
    const credit = parseAmountKopecks(get(cells, iCredit));
    if (!Number.isFinite(credit) || credit <= 0) continue;

    const dateRaw = get(cells, iDate);
    const innCell = get(cells, iInn);
    rows.push({
      date:      parseBankDate(dateRaw) || dateRaw,
      credit,
      payerName: get(cells, iPayer),
      payerInn:  normalizeInn(innCell),
      purpose:   get(cells, iPurpose),
      docNumber: get(cells, iDocNum),
      dateRaw,
      innRaw:    innCell.split("/")[0].trim(),
    });
  }
  return rows;
}

// ── Идентификаторы транзакций ──────────────────────────────────────────────

/** Ключ в старом формате (до исправления): дата_сумма_ИНН. Используется для совместимости. */
export function legacyTxId(dateRaw: string, credit: number, inn: string): string {
  return `${dateRaw}_${credit}_${inn}`;
}

/** Firestore doc id: только [A-Za-z0-9_-], прочее кодируется. */
export function safeDocId(key: string): string {
  return "tx_" + key.replace(/[^A-Za-z0-9_-]/gu, (c) => "~" + c.codePointAt(0)!.toString(16).padStart(6, "0"));
}

export interface KeyedBankRow extends BankRow {
  txId: string;
  /** Порядковый номер (1..N) среди строк выписки с тем же дата_сумма_ИНН */
  occurrence: number;
}

/**
 * txId = дата_сумма_ИНН_#k (k — порядковый номер одинаковых строк в выписке)
 * или дата_сумма_ИНН_n<номер документа>, если номер документа есть.
 */
export function assignTxIds(rows: BankRow[]): KeyedBankRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${row.date}_${row.credit}_${row.payerInn}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const txId = row.docNumber ? `${base}_n${row.docNumber}` : `${base}_#${occurrence}`;
    return { ...row, txId, occurrence };
  });
}

// ── Сопоставление платежей с заказами ──────────────────────────────────────

export interface MatchableOrder {
  id: string;
  customerInn?: string | null;
  totalKopecks: number;
  createdAt: string;
  paid?: boolean;
}

/**
 * Строго ИНН + точная сумма (копейки). Отменённые заказы НЕ исключаются (нужны для акта сверки).
 * Исключаются: оплаченные и id из `taken` (уже сопоставлены в этом импорте / имеют привязанный платёж).
 * Из подходящих выбирается самый старый по createdAt.
 */
export function findMatchingOrder<T extends MatchableOrder>(
  orders: T[], inn: string, credit: number, taken: Set<string>,
): T | undefined {
  if (!inn) return undefined;
  let best: T | undefined;
  for (const o of orders) {
    if (o.paid || taken.has(o.id)) continue;
    if (normalizeInn(o.customerInn) !== inn) continue;
    if (Math.round(o.totalKopecks) !== credit) continue;
    if (!best || String(o.createdAt) < String(best.createdAt)) best = o;
  }
  return best;
}
