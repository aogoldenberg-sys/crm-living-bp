import { AnyKndDocument, KndError, KndResult, KndUsnIncome, KndNdfl2, KndPayment } from "./index.js";

// ───────────────────────────────────────────────
// Вспомогательные функции извлечения данных из XML
// ───────────────────────────────────────────────

/** Возвращает значение атрибута из открывающего тега, или undefined. */
function attr(xml: string, name: string): string | undefined {
  // Ищем атрибут в любом месте XML (берём первое совпадение)
  const re = new RegExp(`${name}="([^"]*)"`, "u");
  return re.exec(xml)?.[1];
}

/** Возвращает текстовое содержимое первого совпавшего тега. */
function tag(xml: string, name: string): string | undefined {
  const re = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "u");
  return re.exec(xml)?.[1]?.trim();
}

/**
 * Парсит строку в целое число копеек.
 * В XML суммы могут быть в рублях (дробные) или уже в копейках.
 * По соглашению ФНС суммы в рублях — целые, поэтому умножаем × 100.
 */
function parseKopecks(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  // Суммы в декларациях ФНС — рубли целые; переводим в копейки
  return Math.round(n * 100);
}

/** Строит базовые поля KndDocument из XML-строки. */
function baseFields(xml: string) {
  return {
    КНД: attr(xml, "КНД"),
    ДатаДок: attr(xml, "ДатаДок"),
    ИННФЛ: attr(xml, "ИННФЛ") || undefined,
    ИННЮЛ: attr(xml, "ИННЮЛ") || undefined,
    КПП: attr(xml, "КПП") || undefined,
  };
}

// ───────────────────────────────────────────────
// Конструкторы результата
// ───────────────────────────────────────────────

function succeed<T>(value: T): KndResult<T> {
  return { ok: true, value };
}

function fail(error: KndError): KndResult<never> {
  return { ok: false, error };
}

// ───────────────────────────────────────────────
// Парсеры по типу КНД
// ───────────────────────────────────────────────

function parseUsn(xml: string, base: ReturnType<typeof baseFields>): KndResult<AnyKndDocument> {
  const candidate = {
    ...base,
    ДохНалПер: parseKopecks(tag(xml, "ДохНалПер")),
    НалБаза: parseKopecks(tag(xml, "НалБаза")),
    СумНал: parseKopecks(tag(xml, "СумНал")),
  };
  const parsed = KndUsnIncome.safeParse(candidate);
  if (!parsed.success) {
    return fail({ code: "parse_error", message: parsed.error.message });
  }
  return succeed(parsed.data);
}

function parseNdfl2(xml: string, base: ReturnType<typeof baseFields>): KndResult<AnyKndDocument> {
  const годRaw = tag(xml, "ГодД") ?? attr(xml, "ГодД");
  // ИННФЛ может быть дочерним тегом или атрибутом корневого элемента
  const иннфл = tag(xml, "ИННФЛ") ?? base.ИННФЛ;
  const candidate = {
    ...base,
    ИННФЛ: иннфл,
    ГодД: годRaw !== undefined ? Number(годRaw) : undefined,
    СуммДох: parseKopecks(tag(xml, "СуммДох")),
  };
  const parsed = KndNdfl2.safeParse(candidate);
  if (!parsed.success) {
    return fail({ code: "parse_error", message: parsed.error.message });
  }
  return succeed(parsed.data);
}

function parsePayment(xml: string, base: ReturnType<typeof baseFields>): KndResult<AnyKndDocument> {
  const суммаRaw = tag(xml, "Сумма") ?? attr(xml, "Сумма");
  const candidate = {
    ...base,
    НомерДок: tag(xml, "НомерДок") ?? attr(xml, "НомерДок"),
    Сумма: parseKopecks(суммаRaw),
    ИННПлат: tag(xml, "ИННПлат") ?? attr(xml, "ИННПлат"),
    ИННПолуч: tag(xml, "ИННПолуч") ?? attr(xml, "ИННПолуч"),
  };
  const parsed = KndPayment.safeParse(candidate);
  if (!parsed.success) {
    return fail({ code: "parse_error", message: parsed.error.message });
  }
  return succeed(parsed.data);
}

// ───────────────────────────────────────────────
// Публичный API
// ───────────────────────────────────────────────

const KND_PARSERS: Record<string, (xml: string, base: ReturnType<typeof baseFields>) => KndResult<AnyKndDocument>> = {
  "1152017": parseUsn,
  "1151078": parseNdfl2,
  "1161101": parsePayment,
};

/**
 * Парсит XML строку КНД-документа ФНС.
 *
 * Не использует внешние XML-библиотеки — только regex.
 * Выбор схемы идёт по атрибуту КНД корневого тега.
 */
export function parseKndXml(xml: string): KndResult<AnyKndDocument> {
  const trimmed = xml.trim();

  // Минимальный sanity-check: должен быть хотя бы один тег
  if (!trimmed.startsWith("<")) {
    return fail({ code: "invalid_xml", message: "Входная строка не является XML" });
  }

  // Ищем атрибут КНД в любом месте документа (берём первое вхождение)
  const кнд = attr(trimmed, "КНД");
  if (!кнд) {
    return fail({ code: "invalid_xml", message: 'Атрибут КНД не найден в XML' });
  }

  const парсер = KND_PARSERS[кнд];
  if (!парсер) {
    return fail({ code: "unknown_knd", message: `Неизвестный КНД: ${кнд}` });
  }

  const base = baseFields(trimmed);
  return парсер(trimmed, base);
}
