import { z } from "zod";
import { Inn, IsoDate, Kopecks } from "../money.js";

/** Локальный Result для schemas-пакета — core недоступен по архитектуре. */
export type KndResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KndError };

export type KndError = {
  code: "unknown_knd" | "invalid_xml" | "parse_error";
  message: string;
};

// ───────────────────────────────────────────────
// Базовая обёртка — общие поля всех КНД-документов
// ───────────────────────────────────────────────

export const KndDocument = z
  .object({
    КНД: z.string().regex(/^\d{7}$/, "КНД: 7 цифр"),
    ДатаДок: IsoDate,
    ИННФЛ: z.string().regex(/^\d{12}$/).optional(),
    ИННЮЛ: z.string().regex(/^\d{10}$/).optional(),
    КПП: z.string().regex(/^\d{9}$/).optional(),
  })
  .strict();
export type KndDocument = z.infer<typeof KndDocument>;

// ───────────────────────────────────────────────
// КНД 1152017 — Декларация по УСН (доходы)
// ───────────────────────────────────────────────

export const KndUsnIncome = KndDocument.extend({
  КНД: z.literal("1152017"),
  /** Доходы за налоговый период, копейки */
  ДохНалПер: Kopecks,
  /** Налоговая база, копейки */
  НалБаза: Kopecks,
  /** Исчисленный налог, копейки */
  СумНал: Kopecks,
}).strict();
export type KndUsnIncome = z.infer<typeof KndUsnIncome>;

// ───────────────────────────────────────────────
// КНД 1151078 — Справка о доходах физлица (2-НДФЛ)
// ───────────────────────────────────────────────

export const KndNdfl2 = KndDocument.extend({
  КНД: z.literal("1151078"),
  /** ИНН физлица (12 цифр) */
  ИННФЛ: z.string().regex(/^\d{12}$/, "ИННФЛ физлица: 12 цифр"),
  /** Год, за который подаётся справка */
  ГодД: z.number().int().min(2000).max(2099),
  /** Общая сумма дохода, копейки */
  СуммДох: Kopecks,
}).strict();
export type KndNdfl2 = z.infer<typeof KndNdfl2>;

// ───────────────────────────────────────────────
// ОСВ — оборотно-сальдовая ведомость (без КНД, отдельная форма)
// ───────────────────────────────────────────────

export const KndOsvRow = z
  .object({
    /** Номер счёта бухучёта, например "51" */
    Счет: z.string().min(1),
    /** Начальное сальдо по дебету, копейки */
    НачДт: Kopecks,
    /** Начальное сальдо по кредиту, копейки */
    НачКт: Kopecks,
    /** Оборот по дебету, копейки */
    ОбДт: Kopecks,
    /** Оборот по кредиту, копейки */
    ОбКт: Kopecks,
    /** Конечное сальдо по дебету, копейки */
    КонДт: Kopecks,
    /** Конечное сальдо по кредиту, копейки */
    КонКт: Kopecks,
  })
  .strict();
export type KndOsvRow = z.infer<typeof KndOsvRow>;

export const KndOsv = z
  .object({
    /** Период ОСВ, ISO-дата начала */
    ДатаНач: IsoDate,
    /** Период ОСВ, ISO-дата конца */
    ДатаКон: IsoDate,
    Строки: z.array(KndOsvRow).min(1),
  })
  .strict();
export type KndOsv = z.infer<typeof KndOsv>;

// ───────────────────────────────────────────────
// КНД 1161101 — Платёжное поручение
// ───────────────────────────────────────────────

export const KndPayment = KndDocument.extend({
  КНД: z.literal("1161101"),
  /** Номер платёжного поручения */
  НомерДок: z.string().min(1),
  /** Сумма платежа, копейки */
  Сумма: Kopecks.positive(),
  /** ИНН плательщика */
  ИННПлат: Inn,
  /** ИНН получателя */
  ИННПолуч: Inn,
}).strict();
export type KndPayment = z.infer<typeof KndPayment>;

// ───────────────────────────────────────────────
// Дискриминированное объединение по полю КНД
// ───────────────────────────────────────────────

export const AnyKndDocument = z.discriminatedUnion("КНД", [
  KndUsnIncome,
  KndNdfl2,
  KndPayment,
]);
export type AnyKndDocument = z.infer<typeof AnyKndDocument>;

export { parseKndXml } from "./parser.js";
