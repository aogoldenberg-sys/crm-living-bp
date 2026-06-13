import { z } from "zod";

/** Деньги — только целые копейки. Float запрещён архитектурно. */
export const Kopecks = z.number().int();
export type Kopecks = z.infer<typeof Kopecks>;

export const PositiveKopecks = Kopecks.positive();

/** Даты — только ISO-8601 UTC строки. Date-объекты не пересекают границы пакетов. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoDateTime = z.string().datetime();

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
