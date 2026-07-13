import { z } from "zod";
import { IsoDate, IsoDateTime, Kopecks } from "./money.js";

const Deviation = z.object({
  metric: z.string().min(1),
  planValue: Kopecks,
  factValue: Kopecks,
  deviationPct: z.number(),
  /** Цепочка причин — человекочитаемо, 1–3 пункта */
  causeChain: z.array(z.string().min(1)),
}).strict();

export const OwnerReport = z.object({
  reportId: z.string().uuid(),
  businessId: z.string().min(1),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  generatedAt: IsoDateTime,
  cash: z.object({
    balance: Kopecks,
    gapDate: IsoDate.nullable(),
    gapAmount: Kopecks.nullable(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  /** Топ-3 отклонения по |deviationPct|, отсортированные по убыванию */
  topDeviations: z.array(Deviation).max(3),
  /** Ровно одна рекомендация или null (если данных недостаточно) */
  recommendation: z.string().nullable(),
  deliveredTo: z.array(z.enum(["telegram", "dashboard"])),
}).strict();

export type OwnerReport = z.infer<typeof OwnerReport>;
export type Deviation = z.infer<typeof Deviation>;
