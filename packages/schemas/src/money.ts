import { z } from "zod";

/** Деньги — только целые копейки. Float запрещён архитектурно. */
export const Kopecks = z.number().int();
export type Kopecks = z.infer<typeof Kopecks>;

export const PositiveKopecks = Kopecks.positive();

/**
 * Даты — только ISO-8601 UTC строки. Date-объекты не пересекают границы пакетов.
 * z.string().date() вместо regex — валидирует реальную дату (2026-13-45 не пройдёт).
 */
export const IsoDate = z.string().date();
export type IsoDate = z.infer<typeof IsoDate>;

/**
 * Только UTC (Z-суффикс). offset вида +03:00 ломает лексикографический порядок:
 * where("ts",">=",since) в Firestore сравнивает строки — "...+03:00" сортируется
 * не там, где "...Z", курсор пропускает события. Инвариант корректности, не стиль.
 * Двойная защита: { offset: false } + refine — на случай изменений поведения zod.
 */
export const IsoDateTime = z
  .string()
  .datetime({ offset: false })
  .refine((s) => s.endsWith("Z"), {
    message: "IsoDateTime: только UTC (Z). Offset +HH:MM запрещён архитектурно",
  });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Inn = z.string().regex(/^\d{10}$|^\d{12}$/, "ИНН: 10 или 12 цифр");

export const DataSource = z.enum([
  "bank_api",
  "statement_import",
  "telephony",
  "ads_api",
  "n8n_parser",
  "voice",
  "manual",
]);
export type DataSource = z.infer<typeof DataSource>;
