import { z } from "zod";
import { PositiveKopecks, IsoDateTime, Inn, DataSource } from "../money.js";

/**
 * Переход сделки на новую стадию воронки.
 * Append-only: история стадий сохраняется полностью, что позволяет
 * считать конверсию и скорость прохождения воронки ретроспективно.
 */
export const DealStageChanged = z.object({
  type: z.literal("deal_stage_changed"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  dealId: z.string().uuid(),
  leadId: z.string().uuid(),
  /** Пустая строка недопустима — стадия должна быть именованной, иначе отчёт по воронке сломается. */
  fromStage: z.string().min(1),
  toStage: z.string().min(1),
  /** Прогнозируемая сумма сделки в копейках; null пока клиент не квалифицирован. */
  estimatedAmount: PositiveKopecks.nullable(),
  counterpartyInn: Inn.nullable(),
  counterpartyName: z.string().min(1),
  managerId: z.string().uuid(),
  source: DataSource,
  businessId: z.string().min(1),
}).strict();

export type DealStageChanged = z.infer<typeof DealStageChanged>;
