import { z } from "zod";

/**
 * Значение гипотезы: точка или диапазон [lo, hi].
 * Денежные значения — целые копейки (unit "₽").
 * Ровно одно из полей обязательно — схема .strict() отклоняет оба или ни одного.
 */
export const AssumptionValuePoint = z
  .object({ point: z.number() })
  .strict();

export const AssumptionValueRange = z
  .object({ lo: z.number(), hi: z.number() })
  .strict();

export const AssumptionValue = z.union([AssumptionValuePoint, AssumptionValueRange]);
export type AssumptionValue = z.infer<typeof AssumptionValue>;

/**
 * Верифицируемость: как и когда гипотеза будет проверена.
 * verifiableBy = null для pre-revenue гипотез (факта ещё нет по определению).
 */
export const Verifiability = z
  .object({
    verifiableBy: z.string().nullable(),
    afterEvent: z.string().nullable(),
  })
  .strict();
export type Verifiability = z.infer<typeof Verifiability>;

/**
 * Одна гипотеза — ключевое предположение бизнес-плана.
 * key — договорная строка (occupancy, avg_night_price, …), не enum.
 * origin: "ai_extracted" | "human" | "computed"
 */
export const Assumption = z
  .object({
    key: z.string().min(1),
    value: AssumptionValue,
    unit: z.string().min(1),
    origin: z.enum(["ai_extracted", "human", "computed"]),
    confidence: z.number().min(0).max(1),
    sourceSection: z.string().nullable(),
    verifiability: Verifiability,
  })
  .strict();
export type Assumption = z.infer<typeof Assumption>;

/**
 * Набор гипотез: ключ → Assumption.
 * Ключи договорные (occupancy, capex_total, grant_minek, …).
 */
export const AssumptionSet = z.record(z.string(), Assumption);
export type AssumptionSet = z.infer<typeof AssumptionSet>;
