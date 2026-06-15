import { z } from "zod";
import { IsoDateTime, DataSource } from "../money.js";

/**
 * Первичный захват лида из любого канала.
 * Отдельное событие (не часть DealStageChanged) — лид мог быть
 * создан вручную или из рекламной системы ещё до открытия сделки.
 */
export const LeadCaptured = z.object({
  type: z.literal("lead_captured"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  leadId: z.string().uuid(),
  /** Канал привлечения нужен для расчёта CAC по источникам в разделе финансового анализа. */
  channel: z.string().min(1),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().email().nullable(),
  source: DataSource,
  businessId: z.string().min(1),
}).strict();

export type LeadCaptured = z.infer<typeof LeadCaptured>;
